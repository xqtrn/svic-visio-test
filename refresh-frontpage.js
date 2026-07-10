// Auto-refresh test.siliconvalleyinvestclub.com homepage: re-snapshot the live
// front page HTML into svic_platform pages.full_html (frontpage row). Keeps the
// homepage grid current with no manual re-parse. Arthur 2026-07-09.
import pg from 'pg';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const UPSTREAM = 'https://siliconvalleyinvestclub.com';
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const fp = (await pool.query('SELECT source_wp_id FROM frontpage WHERE id=1')).rows[0];
  if (!fp) throw new Error('no frontpage row');
  const row = (await pool.query('SELECT id, slug, content_edited FROM pages WHERE wp_id=$1', [fp.source_wp_id])).rows[0];
  if (!row) throw new Error('frontpage page not found for wp_id ' + fp.source_wp_id);
  if (row.content_edited) { console.log('frontpage content_edited=true → skip (admin owns it)'); process.exit(0); }
  const r = await fetch(`${UPSTREAM}/${row.slug}/`, { redirect: 'follow', headers: { 'User-Agent': 'svic-platform-snapshot/1.0' } });
  if (!r.ok) throw new Error(`fetch ${row.slug} HTTP ${r.status}`);
  const html = await r.text();
  // sanity: must be the real homepage grid, not a login/error page
  if (!html.includes('cs-posts-area__main') || html.length < 200000) throw new Error(`suspicious HTML len=${html.length}`);
  const before = (await pool.query('SELECT length(full_html) l FROM pages WHERE id=$1', [row.id])).rows[0].l;
  await pool.query('UPDATE pages SET full_html=$1, updated_at=now() WHERE id=$2 AND content_edited=false', [html, row.id]);
  const after = (await pool.query("SELECT length(full_html) l, (full_html LIKE '%/2026/07/%') OR (full_html LIKE '%/2026/08/%') OR (full_html LIKE '%/2026/09/%') recent FROM pages WHERE id=$1", [row.id])).rows[0];
  console.log(`frontpage refreshed: ${before} → ${after.l} bytes, recent-month-links=${after.recent}`);
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
