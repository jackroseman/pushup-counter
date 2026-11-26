#!/usr/bin/env node
// npm --prefix tools/preview run capture:web [-- --no-video]
// Screenshots the invite web page (web/, served at https://reproyale.vercel.app/i/<code>) in each
// variant, at the same phone size as the app captures, into out/captures/web-invite/. With
// lib/recorder.js present it also records each variant (scrolling through the page) and joins
// the phone variants into web-invite.mp4.
// Needs `npm --prefix web install` once (for the QR code library).
/* global __dirname */
const fs = require('fs');
const path = require('path');
const { launch, PHONE } = require('./lib/browser');
const { OUT } = require('./lib/paths');

const { spawnSync } = require('child_process');
let startRecording = null;
try {
  ({ startRecording } = require('./lib/recorder'));
} catch {
  // Older tools/preview without the recorder: screenshots only.
}

const { renderAll } = require(path.join(__dirname, '..', '..', 'web', 'scripts', 'render.js'));

(async () => {
  const outDir = path.join(OUT, 'captures', 'web-invite');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const video = !!startRecording && !process.argv.includes('--no-video');
  const phoneVideos = [];
  const browser = await launch();
  const pages = await renderAll();
  let n = 0;
  for (const p of pages) {
    const desktop = p.id === 'not-iphone';
    const context = await browser.newContext({
      viewport: desktop ? { width: 1024, height: 900 } : { width: PHONE.width, height: PHONE.height },
      deviceScaleFactor: desktop || video ? 2 : 3,
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
    if (video) {
      const tmp = path.join(outDir, '.video');
      fs.rmSync(tmp, { recursive: true, force: true });
      const rec = await startRecording(page, tmp);
      await page.waitForTimeout(1800);
      // Scroll slowly to the bottom and hold, like reading the page.
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (let y = 0; y < max; y += 12) {
        await page.evaluate((top) => scrollTo(0, top), Math.min(y + 12, max));
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(1500);
      const mp4 = file.replace(/\.png$/, '.mp4');
      if (await rec.stop(mp4)) {
        console.log(`  video ${path.basename(mp4)}`);
        if (!desktop) phoneVideos.push(mp4);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    await context.close();
  }
  await browser.close();
  if (phoneVideos.length) {
    // All phone variants in one file (same 804x1748 size).
    const list = path.join(outDir, 'videos.txt');
    fs.writeFileSync(list, phoneVideos.map((f) => `file '${f}'`).join('\n'));
    const out = path.join(outDir, 'web-invite.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
    fs.rmSync(list, { force: true });
    if (!r.error && r.status === 0) console.log('  video web-invite.mp4 (phone variants)');
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
