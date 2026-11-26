#!/usr/bin/env node
// npm --prefix tools/preview run web [-- --user regular|empty|new] [--reduce-motion] [--rebuild]
// Builds the preview if needed, then opens it in a phone-sized Chromium window with the mock
// backend and the sensor simulator. Click around like on a phone; drive the "sensors" with the
// keyboard (focus the page first):
//   f flat   l lean (not flat yet)   t tilt (phone picked up)   s stall the level sensor
//   r start / stop push-ups   x lose / find the face
// or from DevTools: previewSim.startReps(1100, 5), previewSim.tilt(), previewSim.state() ...
const fs = require('fs');
const path = require('path');
const { WEB } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { openApp } = require('./lib/browser');
const { build } = require('./build');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--rebuild') || !fs.existsSync(path.join(WEB, 'index.html'))) build();
  const server = await serve(WEB, Number(process.env.PREVIEW_PORT || 0));
  const user = opt('--user') || 'regular';
  const { browser, page } = await openApp(server.url, { user, headed: true, keyboard: true, scale: 2, reduceMotion: args.includes('--reduce-motion') });
  page.on('console', (m) => m.text().startsWith('[previewSim]') && console.log(m.text()));
  console.log(`Preview open (user: ${user}). Keys: f flat · l lean · t tilt · s stall · r reps on/off · x face lost/found. Close the window to quit.`);
  await new Promise((resolve) => browser.on('disconnected', resolve));
  await server.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
