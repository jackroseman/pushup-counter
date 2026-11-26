import { depthCaption, formSplit, paceLine, paceSeries, paceText, setClock, setDetails, streakDays, summaryBadge, todayCard } from '../src/progress/summaryModel';
import { presentToday } from '../src/progress';
import type { Rep } from '../src/core';
import type { SessionRecord } from '../src/storage/history';

const today = (reps: number, target: number | null, streak = 0, rest = false) =>
  presentToday({ reps, target, rest, currentStreak: streak, travelLine: null });

function rep(index: number, t: number, quality: Rep['quality'], depthRatio: number): Rep {
  return { index, timestamp: t, quality, source: 'depth', bottomDistance: 0.12, topDistance: 0.42, rangeOfMotion: 0.3, depthRatio, faceLostAtBottom: false } as unknown as Rep;
}

describe('summary model', () => {
  it('formats the set clock', () => {
    expect(setClock(72)).toBe('1:12');
    expect(setClock(31.4)).toBe('0:31');
  });

  it('picks the badge: New best set, First set, and none for goal met', () => {
    expect(summaryBadge({ kind: 'best_set', value: 34 })).toEqual({ label: 'New best set', icon: 'arrowUp' });
    expect(summaryBadge({ kind: 'first_set' })).toEqual({ label: 'First set', icon: 'check' });
    expect(summaryBadge({ kind: 'first_set', goalMet: true })?.label).toBe('First set');
    expect(summaryBadge({ kind: 'goal_met', value: 50 })).toBeNull();
    expect(summaryBadge({ kind: 'milestone', value: 1000 })?.label).toBe('1,000 push-ups');
    expect(summaryBadge(null)).toBeNull();
  });

  it('builds the Today card for goal done, to go, no goal and rest day', () => {
    expect(todayCard(today(56, 50, 13))).toEqual({ reps: 56, target: 50, progress: 1, done: true, line: 'Goal done · 13-day streak' });
    expect(todayCard(today(12, 20))).toEqual({ reps: 12, target: 20, progress: 0.6, done: false, line: '8 to go' });
    expect(todayCard(today(50, 50, 0)).line).toBe('Goal done');
    expect(todayCard(today(30, null))).toEqual({ reps: 30, target: null, progress: null, done: false, line: null });
    expect(todayCard(today(10, 0, 4, true)).line).toBe('Rest day');
    expect(streakDays({ streakLine: '13 day streak' })).toBe(13);
    expect(streakDays({ streakLine: 'Set a goal to start a streak' })).toBe(0);
  });

  it('splits reps by depth', () => {
    expect(formSplit([{ quality: 'full' }, { quality: 'full' }, { quality: 'good' }, { quality: 'shallow' }])).toEqual({ full: 2, good: 1, shallow: 1 });
  });

  it('describes depth and pace plainly', () => {
    expect(depthCaption({ depthStdPct: 4.2, depthConsistency: 'very consistent' })).toBe('Average depth · ±4% steady');
    expect(depthCaption({ depthStdPct: 14, depthConsistency: 'variable' })).toBe('Average depth · ±14% varied');
    expect(depthCaption({ depthStdPct: null, depthConsistency: null })).toBe('Average depth');
    expect(paceText({ avgIntervalSec: 2.14 })).toBe('2.1s');
    expect(paceText({ avgIntervalSec: null })).toBe('–');
    expect(paceLine({ tempo: null })).toMatch(/Not enough/);
    expect(paceLine({ tempo: { firstThirdSec: 2, lastThirdSec: 2.6, changePct: 30, trend: 'slowing' } })).toBe('Slower near the end.');
    expect(paceLine({ tempo: { firstThirdSec: 2, lastThirdSec: 2, changePct: 0, trend: 'steady' } })).toBe('Steady through the set.');
    expect(paceSeries({ intervals: [{ rep: 2, value: 2 }, { rep: 3, value: 0 }, { rep: 4, value: 4 }] })).toEqual([0.5, 0.25]);
  });

  it('has no rep-by-rep fields in Set details', () => {
    const start = Date.parse('2026-11-25T09:30:00-05:00');
    const reps = [rep(1, start + 3000, 'full', 0.9), rep(2, start + 5000, 'good', 0.6), rep(3, start + 7200, 'shallow', 0.3), rep(4, start + 9300, 'full', 0.85)];
    const record = { id: 'x', startedAt: start, endedAt: start + 72_000, reps, summary: {} } as unknown as SessionRecord;
    const m = setDetails(record, start + 3600_000, 'America/New_York');
    expect(m).toMatchObject({ date: 'Today, 9:30 AM', reps: 4, time: '1:12', split: { full: 2, good: 1, shallow: 1 } });
    expect(Object.keys(m).sort()).toEqual(['date', 'depthCaption', 'depthPct', 'paceLine', 'paceSeries', 'pace', 'reps', 'split', 'time'].sort());
  });
});
