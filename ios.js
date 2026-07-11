/* iOS-engine test (Playwright WebKit + CriOS UA) of plan points 39/40 on mobile after. */
const { webkit } = require('playwright');
const fs = require('fs');
let step='init';
const bc=(x)=>{step=x;console.log('[step]',x,new Date().toISOString());};
setInterval(()=>console.log('[hb]',step),15000).unref();
(async () => {
  fs.mkdirSync('out', { recursive: true });
  bc('launch');
  const browser = await webkit.launch();
  bc('launched');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  });
  await ctx.addCookies([
    { name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' },
  ]);
  const page = await ctx.newPage();
  bc('page');
  page.on('crash', () => console.log('[CRASH] page crashed'));
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,160)));
  // тяжесть WebKit-процесса: пускаем только ПЕРВЫЙ клип (hero) — остальные mp4 глушим
  let mp4s = 0;
  await page.route('**/*.mp4*', route => (mp4s++ < 1 ? route.continue() : route.abort()));
  const evalT = (fn, ms) => Promise.race([ page.evaluate(fn),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval-timeout ' + ms + 'ms')), ms)) ]);
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /loadmore|svic|plan/.test(m.text()))) errs.push(m.type()+': '+m.text().slice(0, 160)); });
  bc('goto');
  await page.goto('https://test.siliconvalleyinvestclub.com/', { waitUntil: 'commit', timeout: 60000 });
  bc('committed');
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(e=>console.log('dcl-timeout'));
  bc('dcl');
  await page.waitForTimeout(1500);
  // gesture-unlock БЕЗ навигации: тап в пустую зону топбара (5,5), не tap('body') —
  // на 112K-px странице центр body = карточка → уводило на статью
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('[nav]', f.url().slice(0, 80)); });
  await page.touchscreen.tap(5, 5).catch(() => {});
  await page.waitForTimeout(9000);
  const probe = await evalT(() => {
    const out = { path: location.pathname, ua: navigator.userAgent.slice(0, 30) };
    const hero = document.querySelector('.cs-entry__overlay');
    if (hero) { const r = hero.getBoundingClientRect(); out.heroAspect = +(r.width / r.height).toFixed(3); }
    const v = document.querySelector('video');
    if (v) out.video = { vw: v.videoWidth, vh: v.videoHeight, playing: !v.paused, rs: v.readyState, ct: +v.currentTime.toFixed(1), loop: v.loop, ended: v.ended };
    const d = document.querySelector('.cs-entry__overlay .cs-meta-date');
    if (d) { const cs = getComputedStyle(d); out.date = { color: cs.color, shadow: cs.textShadow.slice(0, 40) }; }
    const rail = document.querySelector('.cnvs-block-row-1587535409467');
    if (rail) {
      const es = [...rail.querySelectorAll('.cs-entry__outer')];
      out.railCount = es.length;
      const rects = es.map(e => e.getBoundingClientRect());
      out.railGaps = rects.slice(1).map((r, i) => Math.round(r.top - rects[i].bottom));
    }
    // цепочка стыка hero: computed-отступы от vcap до следующего медиа
    var v1=document.querySelector('.cnvs-block-posts-1587564778142 .svic-vcap');
    if(v1){ var chain=[], el=v1; for(var i=0;i<7&&el;i++){ var cs=getComputedStyle(el);
      chain.push([el.className.split(' ').slice(0,2).join('.'), cs.marginBottom, cs.paddingBottom]); el=el.parentElement; }
      out.heroChain=chain;
      var img2=document.querySelector('.cnvs-block-posts-1587564829158 img, .cnvs-block-posts-1587564829158 video');
      if(img2) out.heroJunction=Math.round(img2.getBoundingClientRect().top - v1.getBoundingClientRect().bottom);
      var b2=document.querySelector('.cnvs-block-posts-1587564829158'); 
      if(b2){ var c2=getComputedStyle(b2); out.b2=[c2.marginTop,c2.paddingTop]; var pa=b2.querySelector('.cs-posts-area'); if(pa){var cp=getComputedStyle(pa); out.pa2=[cp.marginTop,cp.paddingTop];} }
    }
    // зазоры: подпись hero → фото сателлита-1, и сателлит-1 подпись → фото сателлита-2
    var caps=[].slice.call(document.querySelectorAll('.svic-vcap')).slice(0,3);
    out.capGaps=[];
    caps.forEach(function(c){ var n=c.parentElement.nextElementSibling||((c.closest('.cnvs-block-posts')||{}).nextElementSibling);
      var img=null,el=c; while(el&&!img){ el=el.nextElementSibling||el.parentElement.nextElementSibling; if(el) img=el.querySelector&&el.querySelector('img,video'); if(el&&el.matches&&el.matches('.svic-vcap'))break; }
      if(img){ out.capGaps.push(Math.round(img.getBoundingClientRect().top - c.getBoundingClientRect().bottom)); } });
    out.loadMore = { btn: document.querySelectorAll('.svic-load-more').length,
      grids: [].slice.call(document.querySelectorAll('.cs-posts-area__main')).map(function(g){return g.querySelectorAll('article').length;}).slice(-3),
      hidden: document.querySelectorAll('.svic-hidden-card').length };
    out.planActive = !!document.querySelector('.svic-viewall');
    out.hasSampler = !!document.querySelector('.cs-video-wrapper[data-svic-vid]');
    return out;
  }, 25000);
  console.log('PROBE-IOS:', JSON.stringify(probe)); bc('probe1-done');
  await page.screenshot({ path: 'out/ios-fold.png' });
  // rail region shot: scroll to the unicorn rail and capture
  await evalT(() => { const r = document.querySelector('.cnvs-block-row-1587535409467'); if (r) r.scrollIntoView({ block: 'start' }); }, 15000);
  await page.waitForTimeout(1200);
  const probe2 = await evalT(() => {
    const rail = document.querySelector('.cnvs-block-row-1587535409467');
    const es = rail ? [...rail.querySelectorAll('.cs-entry__outer')] : [];
    const rects = es.map(e => e.getBoundingClientRect());
    return { railGapsScrolled: rects.slice(1).map((r, i) => Math.round(r.top - rects[i].bottom)) };
  }, 15000);
  console.log('PROBE-IOS-RAIL:', JSON.stringify(probe2));
  await page.screenshot({ path: 'out/ios-rail.png' });
  bc('skip-full');
  console.log('ios console-errors=' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''));
  await browser.close();
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
