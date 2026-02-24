/**
 * Temporal Extraction Service
 *
 * Rule-based extraction of temporal references from text.
 * Resolves relative dates ("yesterday", "last Tuesday") to ISO 8601 dates.
 *
 * Reference: EPITOME_TECH_SPEC.md §5.4
 */

export type TemporalPrecision = 'day' | 'month' | 'year' | 'approx';

export interface TemporalResult {
  date: string;          // ISO 8601: YYYY-MM-DD
  precision: TemporalPrecision;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Find the most recent occurrence of a given weekday before `now`.
 * "last Tuesday" when now is Wednesday → the Tuesday that just passed.
 * "last Tuesday" when now is Tuesday → 7 days ago (not today).
 */
function lastWeekday(now: Date, targetDay: number): Date {
  const current = now.getDay();
  let diff = current - targetDay;
  if (diff <= 0) diff += 7;
  const result = new Date(now);
  result.setDate(result.getDate() - diff);
  return result;
}

/**
 * Extract temporal reference from text.
 *
 * Patterns handled:
 * - "yesterday"
 * - "today"
 * - "last [weekday]" (e.g., "last Tuesday")
 * - "last week"
 * - "last month"
 * - "last year"
 * - "in [Month]" or "in [Month] [Year]"
 * - Explicit ISO dates: "2026-03-15" or "2026/03/15"
 * - "on [Month] [Day]" or "[Month] [Day], [Year]"
 *
 * @param text - Input text to scan
 * @param now - Reference date (defaults to current time, UTC)
 * @returns Temporal result or null if no temporal reference found
 */
export function extractTemporalFromText(text: string, now: Date = new Date()): TemporalResult | null {
  const lower = text.toLowerCase();

  // 1. Explicit ISO date: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = text.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return { date: `${y}-${m}-${d}`, precision: 'day' };
  }

  // 2. "today"
  if (/\btoday\b/.test(lower)) {
    return { date: toISO(now), precision: 'day' };
  }

  // 3. "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const yd = new Date(now);
    yd.setDate(yd.getDate() - 1);
    return { date: toISO(yd), precision: 'day' };
  }

  // 4. "last [weekday]"
  const lastDayMatch = lower.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (lastDayMatch) {
    const targetDay = DAY_NAMES.indexOf(lastDayMatch[1]);
    if (targetDay >= 0) {
      const resolved = lastWeekday(now, targetDay);
      return { date: toISO(resolved), precision: 'day' };
    }
  }

  // 5. "last week"
  if (/\blast\s+week\b/.test(lower)) {
    const lw = new Date(now);
    lw.setDate(lw.getDate() - 7);
    return { date: toISO(lw), precision: 'approx' };
  }

  // 6. "last month"
  if (/\blast\s+month\b/.test(lower)) {
    const lm = new Date(now);
    lm.setMonth(lm.getMonth() - 1);
    return { date: `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}-01`, precision: 'month' };
  }

  // 7. "last year"
  if (/\blast\s+year\b/.test(lower)) {
    return { date: `${now.getFullYear() - 1}-01-01`, precision: 'year' };
  }

  // 8. "in [Month]" or "in [Month] [Year]"
  const inMonthMatch = lower.match(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/);
  if (inMonthMatch) {
    const monthIdx = MONTH_NAMES.indexOf(inMonthMatch[1]);
    const year = inMonthMatch[2] ? parseInt(inMonthMatch[2], 10) : now.getFullYear();
    return { date: `${year}-${pad(monthIdx + 1)}-01`, precision: 'month' };
  }

  // 9. "[Month] [Day]" or "[Month] [Day], [Year]" or "on [Month] [Day]"
  const monthDayMatch = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (monthDayMatch) {
    const monthIdx = MONTH_NAMES.indexOf(monthDayMatch[1]);
    const day = parseInt(monthDayMatch[2], 10);
    const year = monthDayMatch[3] ? parseInt(monthDayMatch[3], 10) : now.getFullYear();
    if (day >= 1 && day <= 31) {
      return { date: `${year}-${pad(monthIdx + 1)}-${pad(day)}`, precision: 'day' };
    }
  }

  // No temporal reference found
  return null;
}
