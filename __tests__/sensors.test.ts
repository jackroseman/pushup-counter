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

describe('restartFaceTracking', () => {
  it('starts face tracking again at the given rate on iOS', async () => {
    const startFaceDistance = jest.fn(async () => true);
    const s = load({ startFaceDistance });
    await expect(s.restartFaceTracking(30)).resolves.toBe(true);
    expect(startFaceDistance).toHaveBeenCalledWith(30);
  });

  it('does nothing off iOS (web preview has no face view)', async () => {
    const startFaceDistance = jest.fn(async () => true);
    const s = load({ startFaceDistance }, 'web');
    await expect(s.restartFaceTracking(30)).resolves.toBe(false);
    expect(startFaceDistance).not.toHaveBeenCalled();
  });

  it('never rejects when the native call fails', async () => {
    const s = load({
      startFaceDistance: async () => {
        throw new Error('camera busy');
      },
    });
    await expect(s.restartFaceTracking(30)).resolves.toBe(false);
  });
});
