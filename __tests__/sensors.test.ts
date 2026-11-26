/** Capability checks must be safe on every build: older builds lack the newer native functions. */
type Mod = Record<string, unknown>;

function load(mod: Mod, os: 'ios' | 'web' = 'ios') {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('../modules/pushup-sensors', () => ({ __esModule: true, default: mod }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../src/sensors') as typeof import('../src/sensors');
}

describe('faceMeshVariantSupported', () => {
  it('is true on a 1.3.0+ build with a TrueDepth camera', () => {
    const s = load({ isFaceMeshVariantSupported: () => true, isFaceTrackingSupported: () => true });
    expect(s.faceMeshVariantSupported()).toBe(true);
  });

  it('is false on builds before 1.3.0 (function missing)', () => {
    const s = load({ isFaceTrackingSupported: () => true });
    expect(s.faceMeshVariantSupported()).toBe(false);
  });

  it('is false without a TrueDepth camera', () => {
    const s = load({ isFaceMeshVariantSupported: () => true, isFaceTrackingSupported: () => false });
    expect(s.faceMeshVariantSupported()).toBe(false);
  });

  it('is false when the native call throws', () => {
    const s = load({
      isFaceMeshVariantSupported: () => {
        throw new Error('native module missing');
      },
      isFaceTrackingSupported: () => true,
    });
    expect(s.faceMeshVariantSupported()).toBe(false);
  });

  it('is false off iOS', () => {
    const s = load({ isFaceMeshVariantSupported: () => true, isFaceTrackingSupported: () => true }, 'web');
    expect(s.faceMeshVariantSupported()).toBe(false);
  });
});

describe('existing capability checks stay safe', () => {
  it('motionSupported is false when the function is missing', () => {
    const s = load({});
    expect(s.motionSupported()).toBe(false);
  });

  it('faceTrackingSupported never throws', () => {
    const s = load({
      isFaceTrackingSupported: () => {
        throw new Error('x');
      },
    });
    expect(s.faceTrackingSupported()).toBe(false);
  });
});
