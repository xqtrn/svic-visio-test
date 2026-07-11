// Манифест эфира SVIC TV: все self-hosted ролики с заголовком/ссылкой статьи, новые первыми.
const TEST='https://test.siliconvalleyinvestclub.com', LIVE='https://siliconvalleyinvestclub.com', SITE='195962263';
const CK={'Cookie':'svic_token=edge-preview','User-Agent':'Mozilla/5.0'};
(async()=>{
  const rel=await(await fetch('https://api.github.com/repos/xqtrn/svic-visio-test/releases/tags/clips',{headers:{'User-Agent':'tv','Authorization':'Bearer '+process.env.GH_TOKEN}})).json();
  const have=new Set((rel.assets||[]).map(a=>a.name.replace(/\.mp4$/,'')).filter(n=>!n.endsWith('.json')));
  console.error('clips in release:',have.size);
  const out=[];
  for(let page=1;page<=2;page++){
    const r=await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?per_page=100&page=${page}&_fields=link,title,date`);
    if(!r.ok)break; const posts=await r.json(); if(!posts.length)break;
    for(const p of posts){
      const url=p.link.replace(LIVE,TEST);
      let s=''; try{ s=await(await fetch(url,{headers:CK})).text(); }catch{ continue; }
      const mi=s.indexOf('<div class="cs-entry__media-large'); if(mi<0)continue;
      const block=s.slice(mi,mi+2500);
      const vid=(block.match(/data-(?:svic-vid|video-id)="([A-Za-z0-9_-]+)"/)||[])[1];
      if(!vid||!have.has(vid))continue;
      if(out.some(x=>x.v===vid))continue;
      out.push({v:vid,t:p.title.rendered.replace(/&#8217;/g,"’").replace(/&amp;/g,'&'),u:new URL(p.link).pathname,d:p.date.slice(0,10)});
    }
  }
  console.error('manifest entries:',out.length);
  require('fs').writeFileSync('tv.json',JSON.stringify(out));
  for(const x of out.slice(0,5)) console.error(' ',x.v,x.d,x.t.slice(0,50));
})().catch(e=>{console.error(e);process.exit(1)});
