// Records a page to .mp4 at the device pixel ratio (2x) by taking screenshots in a loop (about
// 10-20 fps). Playwright's recordVideo and the DevTools screencast deliver frames at CSS size
// (402 wide), so recordVideo drew the phone in a quarter of the frame, and raw DevTools
// screenshots with a scaled clip come out zoomed while a sheet is open. Each frame is held until the next one,
// then ffmpeg turns the list into a constant 30 fps H.264 file.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function startRecording(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t = Date.now() / 1000;
      const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
      const ok = await page.screenshot({ path: file, type: 'jpeg', quality: 88, scale: 'device', caret: 'initial', timeout: 5000 }).then(() => true, () => false);
      if (!ok) break;
      frames.push({ file, t });
    }
  })();

  return {
    /** Stops recording and writes mp4. Returns false if ffmpeg is missing or nothing was recorded. */
    async stop(mp4) {
      const end = Date.now() / 1000;
      running = false;
      await loop;
      if (!frames.length) return false;
      const lines = [];
      frames.forEach((f, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(end, f.t + 0.5);
        lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(3)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`); // concat demuxer needs the last file twice
      const list = path.join(dir, 'frames.txt');
      fs.writeFileSync(list, lines.join('\n'));
      if (process.env.PREVIEW_DEBUG) console.log('[rec] frames', frames.length, 'first', frames[0].file);
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
        '-movflags', '+faststart', mp4]);
      return !r.error && r.status === 0;
    },
  };
}

module.exports = { startRecording };
