import {
  formatClockTime,
  formatDeadline,
  formatFriendlyDay,
  formatRelativeAgo,
  formatSetDateTime,
  formatShortDate,
  formatSinceMonth,
  formatTodaySubtitle,
} from '../src/progress';

const ZONE = 'America/New_York';
const NOW = Date.parse('2026-11-25T15:00:00.000-05:00'); // Wednesday, Nov 25, 2026 3:00 PM EST

describe('friendly date formatting', () => {
  it('formats 12-hour clock times without non-breaking spaces', () => {
    expect(formatClockTime('2026-11-25T09:30:00-05:00', ZONE)).toBe('9:30 AM');
    expect(formatClockTime('2026-11-25T18:40:00-05:00', ZONE)).toBe('6:40 PM');
    expect(formatClockTime('2026-11-25T12:15:00-05:00', ZONE)).toBe('12:15 PM');
    expect(formatClockTime('2026-11-25T00:05:00-05:00', ZONE)).toBe('12:05 AM');
  });

  it('formats Today, Yesterday, recent weekdays, and older short dates', () => {
    expect(formatFriendlyDay('2026-11-25', NOW, ZONE)).toBe('Today');
    expect(formatFriendlyDay('2026-11-24', NOW, ZONE)).toBe('Yesterday');
    expect(formatFriendlyDay('2026-11-23', NOW, ZONE)).toBe('Monday');
    expect(formatFriendlyDay('2026-11-19', NOW, ZONE)).toBe('Thursday');
    expect(formatFriendlyDay('2026-11-18', NOW, ZONE)).toBe('Nov 18');
    expect(formatFriendlyDay('2025-11-25', NOW, ZONE)).toBe('Nov 25, 2025');
  });

  it('formats set timestamps cleanly', () => {
    expect(formatSetDateTime(Date.parse('2026-11-25T09:30:00-05:00'), NOW, ZONE)).toBe('Today, 9:30 AM');
    expect(formatSetDateTime(Date.parse('2026-11-24T18:40:00-05:00'), NOW, ZONE)).toBe('Yesterday, 6:40 PM');
    expect(formatSetDateTime(Date.parse('2026-11-23T07:10:00-05:00'), NOW, ZONE)).toBe('Monday, 7:10 AM');
    expect(formatSetDateTime(Date.parse('2026-11-09T07:10:00-05:00'), NOW, ZONE)).toBe('Nov 9, 7:10 AM');
  });

  it('formats Today subtitle, deadlines, relative times, short dates, and member-since month', () => {
    expect(formatTodaySubtitle(NOW, ZONE)).toBe('Wednesday, November 25');
    expect(formatDeadline('2026-11-26T18:00:00-05:00', NOW, ZONE)).toBe('Thursday, 6:00 PM');
    expect(formatDeadline('2026-12-03T18:00:00-05:00', NOW, ZONE)).toBe('Dec 3, 6:00 PM');

    expect(formatRelativeAgo(NOW - 30_000, NOW, ZONE)).toBe('Just now');
    expect(formatRelativeAgo(NOW - 12 * 60_000, NOW, ZONE)).toBe('12m ago');
    expect(formatRelativeAgo(NOW - 2 * 3_600_000, NOW, ZONE)).toBe('2h ago');
    expect(formatRelativeAgo('2026-11-24T18:00:00-05:00', NOW, ZONE)).toBe('Yesterday');
    expect(formatRelativeAgo('2026-11-22T12:00:00-05:00', NOW, ZONE)).toBe('3d ago');
    expect(formatRelativeAgo('2026-11-09T12:00:00-05:00', NOW, ZONE)).toBe('Nov 9');

    expect(formatShortDate('2026-11-16', ZONE, NOW)).toBe('Nov 16');
    expect(formatShortDate('2025-12-31', ZONE, NOW)).toBe('Dec 31, 2025');
    expect(formatSinceMonth('2026-10-03T12:00:00Z', NOW, ZONE)).toBe('Since October');
    expect(formatSinceMonth('2025-10-03T12:00:00Z', NOW, ZONE)).toBe('Since October 2025');
  });
});
