// Map each video-article to its native wordpress.com mp4 (no YouTube).
// article (test.) → data-svic-vid + poster-slug → live /{slug}/ → videos.files.wordpress mp4.
// Output: pairs.json [{vid, url, slug}]. Skips photo-only (no company video). Arthur 2026-07-09.
const TEST = 'https://test.siliconvalleyinvestclub.com';
const LIVE = 'https://siliconvalleyinvestclub.com';
const COOKIE = { 'Cookie': 'svic_token=edge-preview' };
const SITE = '195962263';

async function recentSlugs(n) {
  const out = [];
  for (let page = 1; out.length < n && page <= 5; page++) {
    const r = await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?per_page=50&page=${page}&_fields=slug,date`);
    if (!r.ok) break;
    const b = await r.json();
    if (!b.length) break;
    for (const p of b) out.push(p.slug);
  }
  return out.slice(0, n);
}
function companySlug(poster) {
  // "crusoe-e1783346571895" → "crusoe"; "sambanova" → "sambanova"
  return poster.replace(/-e\d{6,}$/, '').replace(/-\d{6,}$/, '').toLowerCase();
}
async function articleInfo(slug) {
  // date-path prefix is in wp-json; but test. serves by /YYYY/MM/DD/slug — fetch via search? simpler: use live permalink resolve
  const r = await fetch(`${LIVE}/?p=&name=${slug}`); // fallback not reliable; use direct guess below
  return null;
}
async function heroVidAndPoster(url) {
  const r = await fetch(url, { headers: COOKIE });
  if (!r.ok) return null;
  const s = await r.text();
  if (!s.includes('single-post')) return null;
  const vid = (s.match(/data-svic-vid="([A-Za-z0-9_-]+)"/) || [])[1];
  const i = s.indexOf('cs-entry__media-large');
  const block = i >= 0 ? s.slice(i, i + 1200) : s;
  const poster = (block.match(/\/uploads\/20\d\d\/\d\d\/([a-z0-9-]+)\.(?:jpg|png|jpeg)/i) || [])[1];
  return vid && poster ? { vid, poster } : (vid ? { vid, poster: null } : null);
}
async function companyVideo(slug) {
  const r = await fetch(`${LIVE}/${slug}/`, { redirect: 'follow' });
  if (!r.ok) return null;
  const s = await r.text();
  const m = s.match(/https:\/\/videos\.files\.wordpress\.com\/[^"'\s)]+\.mp4/);
  return m ? m[0] : null;
}
(async () => {
  const slugs = await recentSlugs(60);
  // resolve each post's full permalink path via wp-json (has link)
  const links = [];
  for (let page = 1; page <= 5 && links.length < 60; page++) {
    const r = await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?per_page=50&page=${page}&_fields=link,slug,date`);
    if (!r.ok) break; const b = await r.json(); if (!b.length) break;
    for (const p of b) links.push(p.link.replace(LIVE, TEST));
  }
  const pairs = [], seen = new Set();
  let photo = 0, novid = 0;
  for (const url of links.slice(0, 60)) {
    let info; try { info = await heroVidAndPoster(url); } catch { info = null; }
    if (!info || !info.vid) { novid++; continue; }
    if (seen.has(info.vid)) continue; seen.add(info.vid);
    if (!info.poster) { photo++; continue; }
    const cs = companySlug(info.poster);
    let vurl; try { vurl = await companyVideo(cs); } catch { vurl = null; }
    if (!vurl) { photo++; console.error(`no company video: ${cs} (vid ${info.vid})`); continue; }
    pairs.push({ vid: info.vid, url: vurl, slug: cs });
    console.error(`MAP ${info.vid} → ${cs} → ${vurl.slice(0, 70)}`);
  }
  console.error(`scanned=${links.length} withVid=${seen.size} mapped=${pairs.length} noCompanyVideo=${photo} noVid=${novid}`);
  require('fs').writeFileSync('pairs.json', JSON.stringify(pairs, null, 2));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
