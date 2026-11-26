import { bestSetId, groupByDay, rangeChart } from '../src/progress/allSets';

const zone = 'America/New_York';
const now = Date.parse('2026-11-25T16:30:00-05:00'); // Wednesday
const set = (id: string, iso: string, reps: number) => ({ id, startedAt: Date.parse(iso), summary: { totalReps: reps } }) as never;

const sets = [
  set('a', '2026-11-25T09:30:00-05:00', 34),
  set('b', '2026-11-25T07:05:00-05:00', 22),
  set('c', '2026-11-24T18:40:00-05:00', 28),
  set('d', '2026-11-24T12:15:00-05:00', 33),
  set('e', '2026-11-23T07:10:00-05:00', 30),
  set('f', '2026-11-23T06:55:00-05:00', 22),
];

describe('all sets', () => {
  it('groups by day, newest first, with day totals and the best set marked', () => {
    const g = groupByDay(sets, now, zone);
    expect(g.map((d) => [d.label, d.total])).toEqual([
      ['Today', 56],
      ['Yesterday', 61],
      ['Monday', 52],
    ]);
    expect(g[0].rows.map((r) => [r.reps, r.time, r.best])).toEqual([
      [34, '9:30 AM', true],
      [22, '7:05 AM', false],
    ]);
    expect(g.flatMap((d) => d.rows).filter((r) => r.best)).toHaveLength(1);
  });

  it('keeps the earlier set as best on a tie', () => {
    expect(bestSetId([set('new', '2026-11-25T09:00:00-05:00', 30), set('old', '2026-11-20T09:00:00-05:00', 30)])).toBe('old');
    expect(bestSetId([])).toBeNull();
  });

  it('charts this week Monday to Sunday with today highlighted', () => {
    const c = rangeChart(sets, 'week', now, zone);
    expect(c.label).toBe('This week');
    expect(c.total).toBe(169);
    expect(c.bars.map((b) => b.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(c.bars.map((b) => b.value)).toEqual([52, 61, 56, 0, 0, 0, 0]);
    expect(c.bars.map((b) => b.state)).toEqual(['past', 'past', 'current', 'future', 'future', 'future', 'future']);
  });

  it('shows 0 for a quiet week while the list still has older sets', () => {
    const later = Date.parse('2026-12-09T12:00:00-05:00');
    expect(rangeChart(sets, 'week', later, zone).total).toBe(0);
    expect(groupByDay(sets, later, zone)[0].label).toBe('Nov 25');
  });

  it('charts the month by day and the year by month', () => {
    const m = rangeChart(sets, 'month', now, zone);
    expect(m.bars).toHaveLength(30);
    expect(m.total).toBe(169);
    expect(m.bars[24].state).toBe('current');
    const y = rangeChart(sets, 'year', now, zone);
    expect(y.bars).toHaveLength(12);
    expect(y.bars[10]).toMatchObject({ value: 169, state: 'current' });
  });
});
