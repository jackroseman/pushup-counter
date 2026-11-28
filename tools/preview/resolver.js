// Metro resolver for the PREVIEW BUILD ONLY (loaded by ./metro.config.js, which Metro only reads
// when EXPO_OVERRIDE_METRO_CONFIG points at it; see ./build.js). Swaps a few device-only modules for
// browser stand-ins on web. App code is untouched: the swap happens while bundling.
/* global __dirname */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SHIMS = path.join(__dirname, 'shims');
const norm = (p) => p.split(path.sep).join('/');

/** Resolved app file (relative to the repo root) -> stand-in used in the preview build. */
const REPLACE_FILE = {
  'modules/pushup-sensors/src/PushupSensorsModule.web.ts': path.join(SHIMS, 'PushupSensorsModule.ts'),
  'modules/pushup-sensors/src/FaceMeshView.tsx': path.join(SHIMS, 'FaceMeshView.tsx'),
  'src/invites/native.ts': path.join(SHIMS, 'inviteNative.ts'),
  'src/ui/MenuPicker.tsx': path.join(SHIMS, 'MenuPicker.tsx'),
  'src/ui/Segmented.tsx': path.join(SHIMS, 'Segmented.tsx'),
};

/** Package name -> stand-in, for every importer. */
const REPLACE_PACKAGE = {
  'expo-secure-store': path.join(SHIMS, 'secureStore.ts'),
  'expo-apple-authentication': path.join(SHIMS, 'appleAuthentication.tsx'),
};

function previewResolveRequest(context, moduleName, platform) {
  if (platform === 'web') {
    if (REPLACE_PACKAGE[moduleName]) return { type: 'sourceFile', filePath: REPLACE_PACKAGE[moduleName] };
  }
  const resolved = context.resolveRequest(context, moduleName, platform);
  if (platform === 'web' && resolved && resolved.type === 'sourceFile') {
    const shim = REPLACE_FILE[norm(path.relative(ROOT, resolved.filePath))];
    if (shim) return { type: 'sourceFile', filePath: shim };
  }
  return resolved;
}

module.exports = { previewResolveRequest, REPLACE_FILE, REPLACE_PACKAGE, ROOT, norm };
