import { ICON_PATHS, type IconName } from '../src/ui/iconPaths';
import { ICON_NAMES, SF_SYMBOLS } from '../src/ui/Icon';

describe('SF Symbol mapping', () => {
  it('covers every icon name', () => {
    expect(Object.keys(SF_SYMBOLS).sort()).toEqual([...ICON_NAMES].sort());
    for (const name of ICON_NAMES) {
      expect(SF_SYMBOLS[name].length).toBeGreaterThan(0);
    }
  });

  it('keeps an SVG path for the web and Android fallback', () => {
    for (const name of ICON_NAMES) {
      expect(ICON_PATHS[name as IconName]).toMatch(/<(path|circle|rect)\b/);
    }
  });

  it('matches the agreed SF Symbol table', () => {
    expect(SF_SYMBOLS).toEqual({
      flame: 'flame.fill',
      crown: 'crown.fill',
      person: 'person.fill',
      gear: 'gearshape.fill',
      chev: 'chevron.right',
      back: 'chevron.left',
      plus: 'plus',
      xmark: 'xmark',
      bell: 'bell.fill',
      people: 'person.2.fill',
      info: 'info.circle',
      check: 'checkmark',
      trophy: 'trophy',
      bolt: 'bolt.fill',
      share: 'square.and.arrow.up',
      play: 'play.fill',
      phone: 'iphone',
      speaker: 'speaker.wave.2.fill',
      face: 'face.smiling',
      chart: 'chart.bar.fill',
      clock: 'clock',
      medal: 'medal.fill',
      link: 'link',
      ellipsis: 'ellipsis',
      moon: 'moon.fill',
      calendar: 'calendar',
      target: 'target',
      arrowUp: 'arrow.up',
      team: 'person.3.fill',
      search: 'magnifyingglass',
      copy: 'doc.on.doc',
      qr: 'qrcode',
    });
  });
});
