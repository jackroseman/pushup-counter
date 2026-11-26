// Metro config for the PREVIEW BUILD ONLY. The app has no metro.config.js of its own, so EAS builds,
// OTA updates and `expo export` use Expo's default config and never read this file. ./build.js
// points Expo at it with EXPO_OVERRIDE_METRO_CONFIG for the web preview export.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { previewResolveRequest, ROOT } = require('./resolver');

if (process.env.RR_PREVIEW !== '1') {
  throw new Error('tools/preview/metro.config.js is for the web preview only (npm --prefix tools/preview run build).');
}

const config = getDefaultConfig(ROOT);
// react-dom and react-native-web live in tools/preview/node_modules (not the app's dependencies,
// so they cannot change the native fingerprint). Metro falls back to this folder for them.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths || []), path.join(__dirname, 'node_modules')];
config.resolver.resolveRequest = previewResolveRequest;
process.env.PREVIEW_UPSTREAM_BABEL_TRANSFORMER = config.transformer.babelTransformerPath;
config.transformer.babelTransformerPath = path.join(__dirname, 'babelTransformer.js');

module.exports = config;
