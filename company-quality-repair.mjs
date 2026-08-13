import fs from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const profiles = JSON.parse(fs.readFileSync('profile-gaps-all.json', 'utf8'));
const client = await pool.connect();

try {
  await client.query('BEGIN');
  let gapRows = 0;
  for (const profile of profiles) {
    const { rowCount } = await client.query(
      `UPDATE company_profiles
          SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{buildGaps}', $2::jsonb, true)
        WHERE slug = $1`,
      [profile.slug, JSON.stringify(profile.gaps)],
    );
    gapRows += rowCount;
  }

  const { rows } = await client.query(
    `SELECT data FROM company_profiles WHERE slug = 'corgi-insurance' FOR UPDATE`,
  );
  if (!rows[0]) throw new Error('corgi-insurance profile not found');
  const data = rows[0].data || {};
  const reg = data.reg || {};
  reg.productLinks = {
    ...(reg.productLinks || {}),
    'Trucking & Commercial Auto': 'https://www.prnewswire.com/news-releases/corgi-insurance-expands-into-trucking-modernizing-fleet-coverage-with-industry-veterans-302824336.html',
  };
  reg.productsExtra = (reg.productsExtra || []).map((product) =>
    product?.name === 'Corgi Claims'
      ? { ...product, href: 'https://www.prnewswire.com/news-releases/corgi-insurance-launches-corgi-claims-the-ai-native-tpa-302813039.html' }
      : product,
  );
  data.reg = reg;
  await client.query(
    `UPDATE company_profiles
        SET data = $2::jsonb, updated_at = now(), updated_by = 'codex:company-quality-daily'
      WHERE slug = $1`,
    ['corgi-insurance', JSON.stringify(data)],
  );

  await client.query(
    `INSERT INTO audit_log (actor, action, entity_type, before, after, ua)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      'codex:019ffbab-eb5c-77e3-97ff-6153391255b7',
      'company-quality.daily-repair',
      'company_profiles',
      JSON.stringify({ source_snapshot: '2026-08-13T19:03:45.649Z', stale_dead_links: 2 }),
      JSON.stringify({ profile_gap_rows_refreshed: gapRows, dead_links_replaced: 2 }),
      'development-task:c517e27c-d2ea-4b8e-9122-890c151fc377',
    ],
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({ ok: true, profile_gap_rows_refreshed: gapRows, dead_links_replaced: 2 }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
