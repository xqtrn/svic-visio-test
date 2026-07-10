const { chromium } = require('playwright');
const SITE='195962263';
(async()=>{
  require('fs').mkdirSync('out',{recursive:true});
  const posts=await(await fetch(`https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts?after=2026-06-01T23:59:59&per_page=100&_fields=link,slug`)).json();
  posts.sort((a,b)=>a.slug.localeCompare(b.slug));
  const b=await chromium.launch({channel:'chrome'});
  const ctx=await b.newContext({viewport:{width:1280,height:900}});
  await ctx.addCookies([{name:'svic_token',value:'edge-preview',domain:'test.siliconvalleyinvestclub.com',path:'/'}]);
  const results=[];
  for(const post of posts){
    const url=post.link.replace('https://siliconvalleyinvestclub.com','https://test.siliconvalleyinvestclub.com');
    const pg=await ctx.newPage();
    let info={slug:post.slug.slice(0,42),ok:false};
    try{
      await pg.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      await pg.waitForTimeout(6000);
      info=await pg.evaluate(()=>{
        const vids=[...document.querySelectorAll('video')].filter(v=>(v.currentSrc||v.src||'').includes('/svic-video/'));
        const v=vids[0];
        return { hasVid:vids.length>0, src:v?(v.currentSrc||v.src).split('/svic-video/')[1]:null, ready:v?v.readyState:0, w:v?v.videoWidth:0 };
      });
      info.slug=post.slug.slice(0,42);
      info.ok=info.hasVid&&info.ready>=1&&info.w>0;
    }catch(e){ info.err=e.message.slice(0,40); }
    results.push(info);
    console.log(`${info.ok?'OK  ':'FAIL'} ${info.slug.padEnd(44)} src=${info.src||'-'} ready=${info.ready||0} w=${info.w||0}`);
    await pg.close();
  }
  const fail=results.filter(r=>!r.ok);
  console.log(`\n=== ${results.length-fail.length}/${results.length} have working video ===`);
  if(fail.length) console.log('FAILING:',fail.map(f=>f.slug).join(', '));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
