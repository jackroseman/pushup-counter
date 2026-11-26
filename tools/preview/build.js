#!/usr/bin/env node
// npm --prefix tools/preview run build -> tools/preview/out/web: a static web export of the app with the sensor
// simulator and browser stand-ins swapped in (see resolver.js) and a fake Supabase URL baked in.
/* global __dirname */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, WEB, SUPABASE_URL, SUPABASE_ANON_KEY } = require('./lib/paths');

function build() {
  if (!fs.existsSync(path.join(__dirname, 'node_modules/react-native-web'))) {
    throw new Error('Preview tools are not installed. Run: npm --prefix tools/preview run setup');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const log = path.join(OUT, 'build.log');
  const env = {
    ...process.env,
    RR_PREVIEW: '1',
    EXPO_OVERRIDE_METRO_CONFIG: path.join(__dirname, 'metro.config.js'),
    // Never pick up real backend settings from a local .env file.
    EXPO_NO_DOTENV: '1',
    // react-native-web is not an app dependency (see metro.config.js); skip Expo's web setup check.
    EXPO_NO_WEB_SETUP: '1',
    EXPO_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    APP_VARIANT: 'development',
    CI: '1',
  };
  console.log('Building the web preview (expo export --platform web)...');
  const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', WEB, '--clear'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(log, (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) {
    console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
    throw new Error(`expo export failed (full log: ${path.relative(ROOT, log)})`);
  }
  verify();
  console.log(`Preview built: ${path.relative(ROOT, WEB)}`);
}

/** Fail loudly if the stand-ins did not make it into the bundle (e.g. Expo stopped honoring the override). */
function verify() {
  const dir = path.join(WEB, '_expo/static/js/web');
  const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const code = bundles.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  if (!code.includes('RR_PREVIEW_SENSOR_SIMULATOR')) {
    throw new Error('The preview bundle has no sensor simulator: the preview Metro config was not used.');
  }
  if (!code.includes(SUPABASE_URL)) {
    throw new Error('The preview bundle is not pointed at the mock backend.');
  }
}

if (require.main === module) {
  try {
    build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { build };
