import { repCallout } from '../src/session/repCallout';

describe('repCallout (Count out loud)', () => {
  it('says the rep number, with the quality when it was not full', () => {
    expect(repCallout({ index: 4, quality: 'full' }, true)).toBe('4');
    expect(repCallout({ index: 5, quality: 'shallow' }, true)).toBe('5, shallow');
  });

  it('says nothing when Count out loud is off', () => {
    expect(repCallout({ index: 4, quality: 'full' }, false)).toBeNull();
    expect(repCallout({ index: 5, quality: 'shallow' }, false)).toBeNull();
  });
});
