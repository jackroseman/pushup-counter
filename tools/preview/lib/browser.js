// Opens the preview build in Chromium (Playwright) as a phone-sized page, with the mock backend
// answering Supabase, the clock frozen at the fixtures' "now", local storage seeded for the
// chosen user, and every other outside request blocked.
const fs = require('fs');
const { chromium } = require('playwright-core');
const { createBackend } = require('../mock/backend');
const { SUPABASE_URL } = require('./paths');

/** iPhone 16 Pro / 17 logical screen size. */
const PHONE = { width: 402, height: 874 };

async function launch({ headed = false } = {}) {
  const args = ['--no-sandbox', '--font-render-hinting=none'];
  const attempts = [];
  if (process.env.PREVIEW_CHROME) attempts.push({ executablePath: process.env.PREVIEW_CHROME });
  attempts.push({}); // Playwright's own Chromium (npx playwright-core install chromium)
  attempts.push({ channel: 'chrome' }); // installed Google Chrome
  if (fs.existsSync('/usr/bin/google-chrome')) attempts.push({ executablePath: '/usr/bin/google-chrome' });
  let last;
  for (const a of attempts) {
    try {
      return await chromium.launch({ headless: !headed, args, ...a });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    'Could not start Chromium. Install it with `node tools/preview/node_modules/playwright-core/cli.js install chromium`, ' +
      'or set PREVIEW_CHROME to a Chrome/Chromium binary.\n' + (last ? last.message.split('\n')[0] : ''),
  );
}

/**
 * Opens one page. Options (all optional):
 *   user, rpc, tables, storage, now  -> mock/backend.js
 *   reduceMotion: true               -> prefers-reduced-motion: reduce (iOS Reduce Motion)
 *   video: true                      -> device pixel ratio 2 for recording (see lib/recorder.js)
 *   scale: 3                         -> device pixel ratio for screenshots
 *   headed, keyboard                 -> interactive window with simulator shortcuts (web.js)
 */
async function openApp(appUrl, opts = {}) {
  const backend = createBackend(opts);
  const browser = await launch({ headed: opts.headed });
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: opts.scale || (opts.video ? 2 : 3),
    isMobile: true,
    hasTouch: true,
    reducedMotion: opts.reduceMotion ? 'reduce' : 'no-preference',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  });
  await context.clock.install({ time: backend.fixtures.now });

  // Seed local storage once per context (not on reloads), and use the iOS system font where it exists.
  await context.addInitScript(
    ({ storage, keyboard }) => {
      if (!sessionStorage.getItem('preview-seeded')) {
        sessionStorage.setItem('preview-seeded', '1');
        for (const [k, v] of Object.entries(storage)) {
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        }
      }
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '*{font-family:-apple-system,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif !important} ::-webkit-scrollbar{display:none}';
        document.head.appendChild(s);
      });
      if (keyboard) {
        // Simulator shortcuts for the interactive window (ignored while typing in a field).
        window.addEventListener('keydown', (e) => {
          const sim = window.previewSim;
          const t = e.target;
          if (!sim || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
          const s = sim.state();
          const actions = {
            f: () => sim.flat(),
            l: () => sim.lean(),
            t: () => sim.tilt(),
            s: () => sim.stall(!s.stalled),
            r: () => (s.repsStartedAt === null ? sim.startReps() : sim.stopReps()),
            x: () => (s.faceTracked ? sim.loseFace() : sim.findFace()),
          };
          if (actions[e.key]) {
            actions[e.key]();
            console.log('[previewSim]', e.key, JSON.stringify(sim.state()));
          }
        });
      }
    },
    { storage: backend.storage, keyboard: !!opts.keyboard },
  );

  const app = new URL(appUrl);
  const blocked = new Set();
  // Registered first, so it only sees requests the routes below do not handle.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host === app.host || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (!blocked.has(u.host)) {
      blocked.add(u.host);
      if (process.env.PREVIEW_DEBUG) console.log('[preview] blocked outside request to', u.host);
    }
    return route.abort();
  });
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const { status, body } = backend.handle({ method: req.method(), path: u.pathname, accept: req.headers()['accept'], body: req.postData() });
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });

  const page = await context.newPage();
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('[page error]', e.message.split('\n')[0]);
  });
  await page.goto(appUrl + (opts.path || ''), { waitUntil: 'networkidle' });
  return { browser, context, page, backend, errors };
}

module.exports = { openApp, launch, PHONE };
