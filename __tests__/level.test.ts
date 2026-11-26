import { bubbleOffset } from '../src/components/level';
import { TiltMonitor } from '../src/core';

function snapAt(deg: number, axis: 'x' | 'y' = 'x') {
  const m = new TiltMonitor();
  const r = (deg * Math.PI) / 180;
  const g = axis === 'x' ? { x: Math.sin(r), y: 0 } : { x: 0, y: Math.sin(r) };
  return m.add({ t: 0, ...g, z: -Math.cos(r) });
}

describe('level', () => {
  it('centers the bubble when flat and moves it against gravity', () => {
    const flat = bubbleOffset(snapAt(0));
    expect(Math.abs(flat.dx)).toBeLessThan(1e-9);
    expect(Math.abs(flat.dy)).toBeLessThan(1e-9);
    expect(bubbleOffset(snapAt(10, 'x')).dx).toBeLessThan(0);
    expect(bubbleOffset(snapAt(10, 'y')).dy).toBeGreaterThan(0);
  });

  it('keeps the bubble inside the ring', () => {
    const o = bubbleOffset(snapAt(80));
    expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(82);
  });
});
