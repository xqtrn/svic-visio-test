// 14 post-June-1 articles missing video → {key, type, source}
const WP='https://siliconvalleyinvestclub.com';
const wp = [
  ['K5k5Y1Zy6U8','impulse-space'], ['wPN4Gy0QC7w','lovable'], ['pfsoziehm6s','appsflyer'], ['2q5OJDFZrh0','venice-ai'],
];
const wpNoVid = [ ['cs-supabase','supabase'], ['cs-redo','redo'] ];
const yt = [
  ['Tas9YqRV-5U'], ['j8j4C3hZRS4'], ['RqJLL0WBaKQ'], ['8FHBz-aoP-o'],
  ['J_YiHMrG7nc'], ['BNmj7dAezPk'], ['Oy5EghcOnJ4'], ['Aq6mtdnN84Q'],
];
async function wpUrl(slug){ const s=await(await fetch(`${WP}/${slug}/`,{redirect:'follow'})).text(); return (s.match(/https:\/\/videos\.files\.wordpress\.com\/[^"'\s)]+\.mp4/)||[])[0]||null; }
(async()=>{
  const out=[];
  for(const [key,slug] of [...wp,...wpNoVid]){ const u=await wpUrl(slug); if(u) out.push({key,type:'wordpress',source:u,slug}); else console.error('WP MISS',slug); }
  for(const [id] of yt){ out.push({key:id,type:'youtube',source:`https://www.youtube.com/watch?v=${id}`}); }
  require('fs').writeFileSync('manifest-missing.json',JSON.stringify(out,null,2));
  console.error('manifest entries:',out.length,'| wordpress:',out.filter(x=>x.type==='wordpress').length,'| youtube:',out.filter(x=>x.type==='youtube').length);
  for(const x of out) console.error(' ',x.key.padEnd(14),x.type,(x.slug||'').padEnd(14),x.source.slice(0,60));
})();
