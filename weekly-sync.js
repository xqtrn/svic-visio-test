// Автономный видео-синк: каждой статье с роликом — самохостинг-клип в релизе clips.
// Источник соответствий статья→vid: covers.json из релиза (строит tv-manifest.js в
// refresh-frontpage) — БЕЗ самостоятельного скана 1243 страниц (2026-07-17: буря
// fetch'ей ловила rate-limit и тихо давала missing=0). Свежие ≤60 дней — полный
// клип (companyVideo приоритетом), старше — 24s превью (old=1, режет convert.yml).
const LIVE='https://siliconvalleyinvestclub.com';
async function txt(u,o){ const r=await fetch(u,o); return r.ok?await r.text():''; }
async function companyVideo(slug){ const s=await txt(`${LIVE}/${slug}/`,{redirect:'follow'}); return (s.match(/https:\/\/videos\.files\.wordpress\.com\/[^"'\s)]+\.mp4/)||[])[0]||null; }
async function existing(){
  const r=await fetch('https://api.github.com/repos/xqtrn/svic-visio-test/releases/tags/clips',{headers:{'User-Agent':'sync','Authorization':`Bearer ${process.env.GH_TOKEN||''}`}});
  if(!r.ok) return new Set(); const j=await r.json(); return new Set((j.assets||[]).map(a=>a.name.replace(/\.mp4$/,'')));
}
(async()=>{
  const have=await existing();
  if(!have.size){ console.error('FATAL: релиз-ассеты не прочитаны'); process.exit(1); }
  let covers=[]; try{ const r=await fetch('https://github.com/xqtrn/svic-visio-test/releases/download/clips/covers.json',{redirect:'follow'}); if(r.ok) covers=await r.json(); }catch{}
  if(!covers.length){ console.error('FATAL: covers.json пуст — прогони refresh-frontpage'); process.exit(1); }
  const manifest=[];
  for(const c of covers){
    const vid=c.v; if(!vid||have.has(vid)) continue;
    const old=(Date.now()-new Date(c.d).getTime())>60*86400e3?1:0;
    const seg=(c.u||'').split('/').filter(Boolean).pop()||'';
    let wp=null;
    if(!old){ // свежим — WP companyVideo приоритетом (полный клип с сайта компании)
      const token=seg.split('-')[0];
      for(const g of [token, seg.split('-').slice(0,2).join('-')]){ wp=await companyVideo(g); if(wp) break; }
    }
    if(wp) manifest.push({key:vid,type:'wordpress',source:wp,slug:seg,old});
    else manifest.push({key:vid,type:'youtube',source:`https://www.youtube.com/watch?v=${vid}`,slug:seg,old});
  }
  const batch=manifest.slice(0,60); // партия на прогон; ежедневный крон добивает хвост
  require('fs').writeFileSync('manifest-missing.json',JSON.stringify(batch,null,2));
  // cover-slugs.json больше не пополняем тут (нет скана) — существующий не трогаем
  try{ require('fs').accessSync('cover-slugs.json'); }catch{ require('fs').writeFileSync('cover-slugs.json','{}'); }
  console.error(`missing=${batch.length} (wp=${batch.filter(m=>m.type==='wordpress').length} yt=${batch.filter(m=>m.type==='youtube').length}) очередь_всего=${manifest.length}`);
  for(const m of batch.slice(0,8)) console.error('  ',m.key,m.type,m.old?'preview':'full',m.slug.slice(0,40));
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
