// Babel transformer for the PREVIEW BUILD ONLY (set in ./metro.config.js). Wraps Expo's own
// transformer and changes one thing before it runs: in the files listed below, `Platform.OS`
// reads as 'ios' on web. Expo inlines Platform.OS at build time, so on web
// `Platform.OS === 'ios'` would otherwise become `false` and src/sensors.ts would report that
// this "phone" has no Face ID camera, before the simulator is ever asked. The change is made
// in memory while bundling; the source files are not modified.
/* global __dirname */
const path = require('path');
const babel = require('@babel/core');

const UPSTREAM = process.env.PREVIEW_UPSTREAM_BABEL_TRANSFORMER || require.resolve('@expo/metro-config/build/babel-transformer');
const upstream = require(UPSTREAM);
const ROOT = path.resolve(__dirname, '../..');

/** Files (relative to the repo root) whose Platform.OS should read 'ios' in the web preview. */
const PLATFORM_IOS_FILES = new Set(['src/sensors.ts']);

/** Babel plugin: Platform.OS -> 'ios'. Counts replacements so a refactor that removes them fails loudly. */
function platformOsAsIos(counter) {
  return ({ types: t }) => ({
    visitor: {
      MemberExpression(p) {
        const { object, property } = p.node;
        if (t.isIdentifier(object, { name: 'Platform' }) && t.isIdentifier(property, { name: 'OS' }) && !p.parentPath.isAssignmentExpression()) {
          p.replaceWith(t.stringLiteral('ios'));
          counter.n += 1;
        }
      },
    },
  });
}

function rewritePlatform(src, filename) {
  const counter = { n: 0 };
  const out = babel.transformSync(src, {
    filename,
    babelrc: false,
    configFile: false,
    retainLines: true,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [platformOsAsIos(counter)],
  });
  if (counter.n === 0) {
    throw new Error(`[preview] ${filename} no longer reads Platform.OS; update PLATFORM_IOS_FILES in tools/preview/babelTransformer.js`);
  }
  return out.code;
}

module.exports = {
  ...upstream,
  transform(args) {
    const rel = path.relative(ROOT, args.filename).split(path.sep).join('/');
    if (args.options && args.options.platform === 'web' && PLATFORM_IOS_FILES.has(rel)) {
      return upstream.transform({ ...args, src: rewritePlatform(args.src, args.filename) });
    }
    return upstream.transform(args);
  },
  getCacheKey: upstream.getCacheKey ? (...a) => 'rr-preview:' + upstream.getCacheKey(...a) : undefined,
  PLATFORM_IOS_FILES,
  rewritePlatform,
};
