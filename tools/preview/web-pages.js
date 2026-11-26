#!/usr/bin/env node
// npm --prefix tools/preview run capture:web
// Screenshots the invite web page (web/, served at https://reproyale.vercel.app/i/<code>) in each
// variant, at the same phone size as the app captures, into out/captures/web-invite/.
// Needs `npm --prefix web install` once (for the QR code library).
/* global __dirname */
const fs = require('fs');
const path = require('path');
const { launch, PHONE } = require('./lib/browser');
const { OUT } = require('./lib/paths');

const { renderAll } = require(path.join(__dirname, '..', '..', 'web', 'scripts', 'render.js'));

(async () => {
  const outDir = path.join(OUT, 'captures', 'web-invite');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const pages = await renderAll();
  let n = 0;
  for (const p of pages) {
    const desktop = p.id === 'not-iphone';
    const context = await browser.newContext({
      viewport: desktop ? { width: 1024, height: 900 } : { width: PHONE.width, height: PHONE.height },
      deviceScaleFactor: desktop ? 2 : 3,
      userAgent: p.userAgent,
    });
    const page = await context.newPage();
    // Offline: block the network; the page is self-contained.
    await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(p.html, { waitUntil: 'load' });
    n += 1;
    const file = path.join(outDir, `${String(n).padStart(2, '0')}-${p.id}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  shot ${path.basename(file)} (HTTP ${p.status})`);
    await context.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
