// Weekly autonomous video sync: every post-June-1 (rolling) article must have its
// cover/interview video self-hosted. Source priority: wordpress company page → YouTube
// (data-svic-vid) via Penguin residential proxy. No-vid cover-wrap heroes → cs-<slug> + manifest.
const TEST='https://test.siliconvalleyinvestclub.com', LIVE='https://siliconvalleyinvestclub.com', SITE='195962263';
const CK={'Cookie':'svic_token=edge-preview','User-Agent':'Mozilla/5.0'};
async function txt(u,o){ const r=await fetch(u,o); return r.ok?await r.text():''; }
async function companyVideo(slug){ const s=await txt(`${LIVE}/${slug}/`,{redirect:'follow'}); return (s.match(/https:\/\/videos\.files\.wordpress\.com\/[^"'\s)]+\.mp4/)||[])[0]||null; }
async function existing(){ // clip asset names already in release
  const r=await fetch('https://api.github.com/repos/xqtrn/svic-visio-test/releases/tags/clips',{headers:{'User-Agent':'sync','Authorization':`Bearer ${process.env.GH_TOKEN||''}`}});
  if(!r.ok) return new Set(); const j=await r.json(); return new Set((j.assets||[]).map(a=>a.name.replace(/\.mp4$/,'')));
}
(async()=>{
  const have=await existing();
  let interviews=[]; try{ const r=await fetch('https://github.com/xqtrn/svic-visio-test/releases/download/clips/interview-vids.json',{redirect:'follow'}); if(r.ok) interviews=await r.json(); }catch{}
  const isInterview=new Set(interviews);
  // вся история (Артур 2026-07-16: Clara/Ualá 2025 без ховера); свежие первыми,
  // старше 60 дней → 24s-превью (old=1), партия на прогон ограничена ниже
  let posts=[];
  for(let pg=1;pg<=15;pg++){
    const r=await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?per_page=100&page=${pg}&_fields=link,slug,date`);
    if(!r.ok)break; const chunk=await r.json(); if(!chunk.length)break; posts=posts.concat(chunk);
  }
  const manifest=[], covers={};
  for(const p of posts){
    const url=p.link.replace(LIVE,TEST); const s=await txt(url,{headers:CK});
    if(!s) continue;
    // интервью: воркер переписывает data-svic-vid → data-video-id (канон плеера) — ловим оба
    const vid=(s.match(/data-(?:svic-vid|video-id)="([A-Za-z0-9_-]{6,})"/)||[])[1]||null;
    const seg=p.slug; const token=seg.split('-')[0];
    // preferred company-page slug guesses: exact leading token, first two tokens
    const guesses=[token, seg.split('-').slice(0,2).join('-')];
    if(vid){
      if(have.has(vid)) continue;   // уже самохостится; интервью БЕЗ файла тоже в очередь (24s превью)
      const old=(Date.now()-new Date(p.date).getTime())>60*86400e3?1:0; // старым карточкам хватает 24s ховер-превью
      let wp=null; for(const g of guesses){ wp=await companyVideo(g); if(wp) break; }
      if(wp) manifest.push({key:vid,type:'wordpress',source:wp,slug:seg,old});
      else manifest.push({key:vid,type:'youtube',source:`https://www.youtube.com/watch?v=${vid}`,slug:seg,old});
    } else {
      // no vid: only if hero is a cover-wrap (theme expects video) AND company page has one
      const mi=s.indexOf('cs-entry__media-large'); const block=mi>=0?s.slice(mi,mi+1600):'';
      if(block.indexOf('cs-video-wrap')<0 && block.indexOf('cs-video-wrapper')>=0) continue;
      let wp=null,gslug=null; for(const g of guesses){ wp=await companyVideo(g); if(wp){gslug=g;break;} }
      if(!wp) continue;
      covers[gslug]='cs-'+gslug;
      if(!have.has('cs-'+gslug)) manifest.push({key:'cs-'+gslug,type:'wordpress',source:wp,slug:seg});
    }
  }
  const batch=manifest.slice(0,60); // партия на прогон: CI-таймаут; ежедневный крон добивает хвост
  require('fs').writeFileSync('manifest-missing.json',JSON.stringify(batch,null,2));
  if(manifest.length>batch.length) console.error(`(в очереди ещё ${manifest.length-batch.length} — следующие прогоны)`);
  // merge covers into cover-slugs.json (never drop existing)
  let cur={}; try{cur=JSON.parse(require('fs').readFileSync('cover-slugs.json','utf8'));}catch{}
  require('fs').writeFileSync('cover-slugs.json',JSON.stringify({...cur,...covers},null,2));
  console.error(`missing=${manifest.length} (wp=${manifest.filter(m=>m.type==='wordpress').length} yt=${manifest.filter(m=>m.type==='youtube').length}) covers=${Object.keys(covers).length}`);
  for(const m of manifest) console.error('  ',m.key,m.type,m.slug);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
