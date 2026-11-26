/**
 * The preview build swaps device-only modules for stand-ins. These checks keep the swaps pointed
 * at files that exist, limited to web, and failing loudly if the app code they rely on changes.
 */
const { describe, it, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const { previewResolveRequest, REPLACE_FILE, REPLACE_PACKAGE, ROOT } = require('../resolver');
const { rewritePlatform, PLATFORM_IOS_FILES } = require('../babelTransformer');

const fakeContext = (filePath) => ({
  originModulePath: path.join(ROOT, 'src/x.ts'),
  resolveRequest: () => ({ type: 'sourceFile', filePath }),
});

describe('preview build swaps', () => {
  it('every replaced app file and every stand-in exists', () => {
    for (const [file, shim] of Object.entries(REPLACE_FILE)) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      expect(fs.existsSync(shim)).toBe(true);
    }
    for (const shim of Object.values(REPLACE_PACKAGE)) expect(fs.existsSync(shim)).toBe(true);
  });

  it('swaps only on web', () => {
    const real = path.join(ROOT, 'modules/pushup-sensors/src/PushupSensorsModule.web.ts');
    const web = previewResolveRequest(fakeContext(real), './src/PushupSensorsModule', 'web');
    expect(web.filePath).toContain(path.join('tools', 'preview', 'shims'));
    expect(previewResolveRequest(fakeContext(real), './src/PushupSensorsModule', 'ios').filePath).toBe(real);
    expect(previewResolveRequest(fakeContext('/x'), 'expo-secure-store', 'ios').filePath).toBe('/x');
    expect(previewResolveRequest(fakeContext('/x'), 'expo-secure-store', 'web').filePath).toContain('secureStore');
  });

  it("reads Platform.OS as 'ios' in the listed files", () => {
    for (const rel of PLATFORM_IOS_FILES) {
      const file = path.join(ROOT, rel);
      const out = rewritePlatform(fs.readFileSync(file, 'utf8'), file);
      expect(out).not.toMatch(/Platform\.OS/);
      expect(out).toMatch(/["']ios["'] === 'ios'/);
    }
  });

  it('the app never imports the preview tooling (so tools/ changes cannot change the app)', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== 'ios' && e.name !== 'android') walk(p);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && /tools\/preview/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    };
    for (const dir of ['src', 'modules']) walk(path.join(ROOT, dir));
    for (const file of ['App.tsx', 'index.ts', 'app.config.ts']) {
      if (/tools\/preview/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
