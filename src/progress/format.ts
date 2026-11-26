import { calendarDaysBetween, localDate, weekdayName } from './calendar';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function toMs(value: number | string): number {
  if (typeof value === 'number') return value;
  if (ISO_DATE.test(value)) return Date.parse(`${value}T12:00:00.000Z`);
  return Date.parse(value);
}

function toIsoDate(value: string | number, timeZone: string): string {
  if (typeof value === 'string' && ISO_DATE.test(value)) return value;
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return localDate(Date.now(), timeZone);
  return localDate(ms, timeZone);
}

/** `9:30 AM`, `6:40 PM`. */
export function formatClockTime(value: number | string, timeZone: string = defaultTimeZone()): string {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const period = get('dayPeriod').toUpperCase();
  return `${get('hour')}:${get('minute')} ${period}`;
}

/** `Nov 9`, or `Nov 9, 2025` when in another year. */
export function formatShortDate(
  dateOrMs: string | number,
  timeZone: string = defaultTimeZone(),
  nowMs: number = Date.now(),
): string {
  const iso = toIsoDate(dateOrMs, timeZone);
  const [year, month, day] = iso.split('-').map(Number);
  const currentYear = Number(localDate(nowMs, timeZone).slice(0, 4));
  const label = `${SHORT_MONTHS[month - 1]} ${day}`;
  return year === currentYear ? label : `${label}, ${year}`;
}

/** `Today`, `Yesterday`, weekday within the last 6 days, else `Nov 9`. */
export function formatFriendlyDay(
  dateOrMs: string | number,
  nowMs: number = Date.now(),
  timeZone: string = defaultTimeZone(),
): string {
  const iso = toIsoDate(dateOrMs, timeZone);
  const todayIso = localDate(nowMs, timeZone);
  const diff = calendarDaysBetween(iso, todayIso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff >= 2 && diff <= 6) return weekdayName(iso);
  return formatShortDate(iso, timeZone, nowMs);
}

/** `Today, 9:30 AM`, `Yesterday, 6:40 PM`, `Monday, 7:10 AM`, `Nov 9, 7:10 AM`. */
export function formatSetDateTime(
  msOrIso: number | string,
  nowMs: number = Date.now(),
  timeZone: string = defaultTimeZone(),
): string {
  const ms = toMs(msOrIso);
  if (!Number.isFinite(ms)) return '';
  return `${formatFriendlyDay(ms, nowMs, timeZone)}, ${formatClockTime(ms, timeZone)}`;
}

/** `Wednesday, November 25`. */
export function formatTodaySubtitle(nowMs: number = Date.now(), timeZone: string = defaultTimeZone()): string {
  const iso = localDate(nowMs, timeZone);
  const [, month, day] = iso.split('-').map(Number);
  return `${weekdayName(iso)}, ${FULL_MONTHS[month - 1]} ${day}`;
}

/** `Thursday, 6:00 PM` when within the next week, else `Dec 3, 6:00 PM`. */
export function formatDeadline(
  msOrIso: number | string,
  nowMs: number = Date.now(),
  timeZone: string = defaultTimeZone(),
): string {
  const ms = toMs(msOrIso);
  if (!Number.isFinite(ms)) return '';
  const iso = localDate(ms, timeZone);
  const todayIso = localDate(nowMs, timeZone);
  const diff = calendarDaysBetween(todayIso, iso);
  const day = diff >= 0 && diff <= 6 ? weekdayName(iso) : formatShortDate(iso, timeZone, nowMs);
  return `${day}, ${formatClockTime(ms, timeZone)}`;
}

/** `Just now`, `5m ago`, `2h ago`, `Yesterday`, `3d ago`, else `Nov 9`. */
export function formatRelativeAgo(
  msOrIso: number | string,
  nowMs: number = Date.now(),
  timeZone: string = defaultTimeZone(),
): string {
  const ms = toMs(msOrIso);
  if (!Number.isFinite(ms)) return '';
  const deltaMs = Math.max(0, nowMs - ms);
  if (deltaMs < 60_000) return 'Just now';
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  const iso = localDate(ms, timeZone);
  const todayIso = localDate(nowMs, timeZone);
  const diffDays = calendarDaysBetween(iso, todayIso);
  if (diffDays === 0) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 6) return `${diffDays}d ago`;
  return formatShortDate(iso, timeZone, nowMs);
}

/** `Since October`, or `Since October 2025` when in another year. */
export function formatSinceMonth(
  msOrIso: number | string,
  nowMs: number = Date.now(),
  timeZone: string = defaultTimeZone(),
): string {
  const iso = toIsoDate(msOrIso, timeZone);
  const [year, month] = iso.split('-').map(Number);
  const currentYear = Number(localDate(nowMs, timeZone).slice(0, 4));
  const label = `Since ${FULL_MONTHS[month - 1]}`;
  return year === currentYear ? label : `${label} ${year}`;
}
