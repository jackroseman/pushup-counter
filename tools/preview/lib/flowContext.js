// The helpers every flow gets (see flows/*.js and docs/ui-preview.md).
const fs = require('fs');
const path = require('path');

// A grey circle where the tap lands (recordings only), like iOS's "Show Touches".
async function touchDot(page, loc) {
  const box = await loc.boundingBox({ timeout: 8000 }).catch(() => null);
  if (!box) return;
  await page.evaluate(({ x, y }) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:22px;background:rgba(255,255,255,.45);border:2px solid rgba(255,255,255,.8);pointer-events:none;z-index:2147483647;transition:opacity .35s`;
    document.body.appendChild(d);
    setTimeout(() => (d.style.opacity = '0'), 450);
    setTimeout(() => d.remove(), 900);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(350);
}

// recording: hold each screenshot for a moment and show a touch dot on taps, so the .mp4 is
// easy to follow. Screenshots are the same either way.
function flowContext({ page, outDir, reduceMotion, recording = false, log = console.log }) {
  let n = 0;
  const sim = (method, ...args) =>
    page.evaluate(({ method, args }) => {
      if (!window.previewSim) throw new Error('window.previewSim is missing: is this the preview build?');
      return window.previewSim[method](...args);
    }, { method, args });

  const ctx = {
    page,
    reduceMotion,
    log,
    /** Wait this many ms (the page clock runs in real time). */
    pause: (ms) => page.waitForTimeout(ms),
    /** Save a numbered screenshot: 01-today.png, 02-..., returns its path. */
    shot: async (name) => {
      n += 1;
      const file = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: file });
      log(`  shot ${path.basename(file)}`);
      if (recording) await page.waitForTimeout(900);
      return file;
    },
    /** Wait until text (string = exact, RegExp = match) is visible. */
    waitFor: (text, ms = 20000) => page.getByText(text, { exact: typeof text === 'string' }).first().waitFor({ timeout: ms }),
    /**
     * Tap a control by its visible text, or by its accessibility label with { label: true }.
     * { last: true } picks the last match (e.g. the tab bar's "You" rather than a heading).
     */
    tap: async (text, o = {}) => {
      const loc = o.label ? page.getByLabel(text, { exact: typeof text === 'string' }) : page.getByText(text, { exact: typeof text === 'string' });
      const target = o.last ? loc.last() : loc.first();
      if (recording) await touchDot(page, target);
      await target.click({ timeout: o.timeout || 8000 });
      await page.waitForTimeout(o.wait ?? 1200);
    },
    /** Browser back (like the back button / swipe back). */
    back: async (wait = 1500) => {
      await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(wait);
    },
    /** Is this text on screen right now? */
    has: async (text) => (await page.getByText(text, { exact: typeof text === 'string' }).count()) > 0,
    /** Drive the sensor simulator (same methods as window.previewSim). */
    sim: {
      flat: () => sim('flat'),
      lean: () => sim('lean'),
      tilt: () => sim('tilt'),
      stall: (on = true) => sim('stall', on),
      loseFace: () => sim('loseFace'),
      findFace: () => sim('findFace'),
      startReps: (periodMs, count) => sim('startReps', periodMs, count),
      stopReps: () => sim('stopReps'),
      expectedReps: () => sim('expectedReps'),
      state: () => sim('state'),
    },
    /** The rep count the set screen shows (from its "N reps" accessibility label), or null. */
    repCount: async () => {
      const label = await page
        .locator('[aria-label$=" reps"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).find((l) => /^\d+ reps$/.test(l || '')) || null);
      return label ? Number(label.split(' ')[0]) : null;
    },
    /**
     * Do `count` push-ups at `periodMs` each, then check the app counted exactly `count`.
     * Throws if it did not, so a broken rep counter fails the capture.
     */
    doReps: async (count, periodMs = 1100) => {
      await ctx.sim.startReps(periodMs, count);
      await page.waitForTimeout(periodMs * count + 700);
      const shown = await ctx.repCount();
      if (shown !== count) throw new Error(`Expected the app to count ${count} reps, it shows ${shown}`);
      log(`  reps counted: ${shown} (simulated ${count})`);
      return shown;
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  return ctx;
}

module.exports = { flowContext };
