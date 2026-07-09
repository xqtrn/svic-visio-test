const { chromium, webkit } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  for (const [eng, name, vp] of [[chromium, 'desktop', { width: 1440, height: 1000 }], [webkit, 'ioswk', { width: 390, height: 844 }]]) {
    const b = await eng.launch(eng === chromium ? { channel: 'chrome' } : {});
    const pg = await (await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: name === 'ioswk', hasTouch: name === 'ioswk' })).newPage();
    await pg.goto('file://' + process.cwd() + '/ds-snapshot.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => document.getElementById('public-site').scrollIntoView());
    await pg.waitForTimeout(600);
    const probe = await pg.evaluate(() => {
      const secs = [...document.querySelectorAll('section.bb-sec')].map(x => x.id);
      const nav = [...document.querySelectorAll('.bb-nav a[href^="#"]')].filter(a=>a.getAttribute('href')!=='#bbmain').map(a => a.getAttribute('href').slice(1));
      const groups = [...document.querySelectorAll('.bb-nav .eyebrow')].map(e => e.textContent.trim()).slice(1);
      const ps = document.getElementById('public-site');
      return { sections: secs.length, navOk: nav.every(h => secs.includes(h)), groups,
               psSubs: ps.querySelectorAll('.bb-sub').length, psPreviews: ps.querySelectorAll('[data-code]').length, unlockGuide: !!document.getElementById('motion-unlock') };
    });
    console.log('DS-PROBE-' + name + ':', JSON.stringify(probe));
    await pg.screenshot({ path: 'out/ds-' + name + '.png' });
    await b.close();
  }
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
