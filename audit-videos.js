const TEST='https://test.siliconvalleyinvestclub.com', LIVE='https://siliconvalleyinvestclub.com', SITE='195962263';
const CK={'Cookie':'svic_token=edge-preview','User-Agent':'Mozilla/5.0'};
(async()=>{
  const posts=await (await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?after=2026-06-01T23:59:59&per_page=100&_fields=link,slug,date`)).json();
  posts.sort((a,b)=>a.date.localeCompare(b.date));
  const rows=[];
  for(const p of posts){
    const url=p.link.replace(LIVE,TEST);
    let s=''; try{ s=await (await fetch(url,{headers:CK})).text(); }catch{}
    const vid=(s.match(/data-svic-vid="([A-Za-z0-9_-]+)"/)||[])[1]||null;
    const i=s.indexOf('cs-entry__media-large'); const block=i>=0?s.slice(i,i+1400):s;
    const poster=(block.match(/\/uploads\/20\d\d\/\d\d\/([A-Za-z0-9-]+)\.(?:jpg|png|jpeg)/i)||[])[1]||null;
    const isVideo=block.includes('cs-video-wrap')||block.includes('data-svic-vid');
    let clip='n/a';
    if(vid){ const r=await fetch(`${TEST}/svic-video/${vid}.mp4`,{headers:{...CK,Range:'bytes=0-1023'}}); clip=r.status; }
    rows.push({date:p.date.slice(0,10),slug:p.slug,vid,poster,isVideo,clip,ok:vid&&(clip===200||clip===206)});
  }
  require('fs').writeFileSync('audit.json',JSON.stringify(rows,null,2));
  for(const r of rows) console.log(`${r.date} ${r.slug.slice(0,42).padEnd(42)} vid=${(r.vid||'NONE').padEnd(12)} clip=${String(r.clip).padEnd(4)} ${r.ok?'OK':(r.isVideo?'NEEDS-VIDEO':'photo?')}`);
  const miss=rows.filter(r=>!r.ok);
  console.log('\nMISSING:',miss.length,'of',rows.length);
})().catch(e=>{console.error(e);process.exit(1)});
