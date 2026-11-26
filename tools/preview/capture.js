#!/usr/bin/env node
// npm --prefix tools/preview run capture -- <flow ...|all> [--reduce-motion] [--no-video] [--list]
// Runs scripted flows (flows/*.js) against the preview build, saving numbered screenshots and an
// .mp4 recording per flow into tools/preview/out/captures/<flow>/.
/* global __dirname */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WEB, OUT, ROOT } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { openApp } = require('./lib/browser');
const { flowContext } = require('./lib/flowContext');

const FLOWS_DIR = path.join(__dirname, 'flows');

// A flow file exports one flow, or { variants: [{ id, ... }] } for several small flows that share
// a file (each becomes "<file>-<id>", e.g. invite-share).
function loadFlows() {
  return fs
    .readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.js'))
    .flatMap((f) => {
      const base = path.basename(f, '.js');
      const mod = require(path.join(FLOWS_DIR, f));
      if (!Array.isArray(mod.variants)) return [{ id: base, ...mod }];
      return mod.variants.map((v, i) => ({ order: (mod.order ?? 99) + i / 100, ...v, id: `${base}-${v.id}` }));
    })
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

function toMp4(webm, mp4) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4]);
  if (r.error || r.status !== 0) return false;
  fs.rmSync(webm, { force: true });
  return true;
}

async function runFlow(flow, appUrl, { reduceMotion, video }) {
  const name = flow.id + (reduceMotion ? '-reduce-motion' : '');
  const outDir = path.join(OUT, 'captures', name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`▶ ${name}: ${flow.description || ''}`);
  const wantVideo = video && flow.video !== false;
  const videoTmp = path.join(outDir, '.video');
  const { browser, context, page, errors } = await openApp(appUrl, { ...flow.options, reduceMotion, video: wantVideo ? videoTmp : undefined });
  const ctx = flowContext({ page, outDir, reduceMotion });
  let failed = null;
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  let timer;
  try {
    await page.waitForTimeout(flow.options?.settleMs ?? 2500);
    const limit = flow.timeoutMs ?? 120000;
    await Promise.race([
      flow.run(ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`flow took longer than ${limit / 1000}s`)), limit);
      }),
    ]);
  } catch (e) {
    failed = e;
    console.log(`  ✗ ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(outDir, 'zz-failed.png') }).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
  const vid = wantVideo ? page.video() : null;
  await context.close();
  await browser.close();
  if (vid) {
    const webm = await vid.path();
    const mp4 = path.join(outDir, `${name}.mp4`);
    if (toMp4(webm, mp4)) console.log(`  video ${path.relative(ROOT, mp4)}`);
    else {
      fs.renameSync(webm, path.join(outDir, `${name}.webm`));
      console.log('  video saved as .webm (install ffmpeg to get .mp4)');
    }
    fs.rmSync(videoTmp, { recursive: true, force: true });
  }
  if (errors.length) console.log(`  page errors: ${errors.length} (see above)`);
  console.log(failed ? `  FAILED: ${path.relative(ROOT, outDir)}` : `  ok: ${path.relative(ROOT, outDir)}`);
  return !failed;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const names = args.filter((a) => !a.startsWith('--'));
  const flows = loadFlows();
  if (flags.has('--list') || names.length === 0) {
    console.log('Flows (npm --prefix tools/preview run capture -- <flow ...|all> [--reduce-motion] [--no-video]):');
    for (const f of flows) console.log(`  ${f.id.padEnd(22)} ${f.description || ''}`);
    return names.length === 0 && !flags.has('--list') ? 1 : 0;
  }
  const unknown = names.filter((n) => n !== 'all' && !flows.some((f) => f.id === n));
  if (unknown.length) throw new Error(`Unknown flow: ${unknown.join(', ')}. Try --list.`);
  const selected = names.includes('all') ? flows : flows.filter((f) => names.includes(f.id));
  const server = await serve(WEB);
  let ok = true;
  try {
    for (const flow of selected) {
      ok = (await runFlow(flow, server.url, { reduceMotion: flags.has('--reduce-motion'), video: !flags.has('--no-video') })) && ok;
    }
  } finally {
    await server.close();
  }
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);
