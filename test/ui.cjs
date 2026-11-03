const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 384, height: 860 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const t0 = Date.now();
  await p.goto('http://localhost:8766/');
  await p.waitForSelector('#poolSel', { timeout: 30000 });
  console.log('loaded in', Date.now() - t0, 'ms');
  // add set
  await p.click('#addSet'); await p.fill('#setQ', 'strixhaven'); await p.waitForTimeout(200);
  await p.click('[data-set="SOS"]'); await p.waitForTimeout(200);
  // type names
  for (const q of ['ark of h', 'silverquill ch', 'last gasp', 'last gasp', 'owlin hist', 'group proj']) { await p.fill('#acIn', q); await p.waitForTimeout(150); await p.press('#acIn', 'Enter'); }
  await p.screenshot({ path: '/tmp/shots/1-pool-search.png', fullPage: false });
  // browse mode: tap 60 cards
  await p.click('[data-mode="browse"]'); await p.waitForTimeout(200);
  const n = await p.$$eval('.brcard', els => els.length); console.log('browse cards', n);
  const btns = await p.$$('.brcard');
  for (let i = 0; i < Math.min(btns.length, 260); i += 4) await btns[i].click();
  await p.screenshot({ path: '/tmp/shots/2-pool-browse.png' });
  console.log('pool total', await p.textContent('h2 .muted'));
  await p.click('#toBuild'); await p.waitForSelector('#go');
  await p.screenshot({ path: '/tmp/shots/3-build.png', fullPage: true });
  await p.click('#onlineCombos'); // offline test env
  await p.click('#go'); await p.waitForSelector('.decklist', { timeout: 30000 });
  await p.screenshot({ path: '/tmp/shots/4-deck.png', fullPage: true });
  console.log('deck h2', await p.textContent('#view h2'));
  // card modal
  await p.click('.decklist .crow'); await p.waitForSelector('.cardview'); await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/shots/5-card.png' });
  await p.click('.sheet .close');
  // rules
  await p.goto('http://localhost:8766/#rules'); await p.waitForSelector('#rq');
  await p.fill('#rq', 'deathtouch trample'); await p.waitForTimeout(400);
  for (const q of ['blood artist', 'viscera seer']) { await p.fill('#ixIn', q); await p.waitForTimeout(150); await p.click('#ixList .acitem'); await p.waitForTimeout(150); }
  await p.screenshot({ path: '/tmp/shots/6-rules.png', fullPage: true });
  await p.click('.rref'); await p.waitForTimeout(200); await p.screenshot({ path: '/tmp/shots/7-rule-modal.png' });
  await p.goBack(); await p.waitForTimeout(200);
  await p.goto('http://localhost:8766/#cards'); await p.fill('#cq', 't:dragon c:r mv<=5 s:sos'); await p.waitForTimeout(500);
  console.log('card search results', await p.$$eval('#cres .crow', e => e.length));
  await p.goto('http://localhost:8766/#data'); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/shots/8-data.png', fullPage: true });
  // inner screen
  await p.setViewportSize({ width: 780, height: 880 }); await p.goto('http://localhost:8766/#deck'); await p.waitForTimeout(300);
  await p.goto('http://localhost:8766/#build'); await p.click('#go'); await p.waitForSelector('.decklist');
  await p.screenshot({ path: '/tmp/shots/9-deck-inner.png' });
  console.log('errors', errs);
  await b.close();
})();
