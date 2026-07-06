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
      const s = document.getElementById('public-site');
      return { notes: s.querySelectorAll('.bb-note').length, rows: s.querySelectorAll('tbody tr').length,
               subs: s.querySelectorAll('.bb-sub').length, navLink: !!document.querySelector('a[href="#public-site"]'),
               w: Math.round(s.getBoundingClientRect().width) };
    });
    console.log('DS-PROBE-' + name + ':', JSON.stringify(probe));
    await pg.screenshot({ path: 'out/ds-' + name + '.png' });
    await b.close();
  }
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
