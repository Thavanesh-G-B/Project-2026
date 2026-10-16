// Headless smoke test: loads the game, drives some input, reports console errors, writes screenshots.
// Usage: NODE_PATH=<dir containing playwright> node tools/smoke_test.js [outDir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction(() => typeof G !== 'undefined' && G.state === 'title', null, { timeout: 15000 });
  await page.screenshot({ path: out + '/01_title.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/02_start.png' });
  // walk, jump, slash, dash
  await page.keyboard.down('KeyD'); await page.waitForTimeout(700);
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(120);
  await page.screenshot({ path: out + '/03_slash.png' });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyK'); await page.waitForTimeout(150);
  await page.screenshot({ path: out + '/04_dash.png' });
  await page.keyboard.up('KeyD');
  console.log(JSON.stringify(await page.evaluate(() => ({ state: G.state, x: Math.round(G.player.x), y: Math.round(G.player.y), hp: G.player.hp, mana: Math.round(G.player.mana) }))));
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
