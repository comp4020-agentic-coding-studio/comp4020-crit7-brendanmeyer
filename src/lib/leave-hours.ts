// Pure business-day and partial-hours math for leave requests. No DB import
// here on purpose: this module has to be safe to import from spec files
// without ever triggering src/lib/db.ts's module-load side effects
// (migrate() + seeding).

export const FULL_DAY_HOURS = 7;

function parseISODate(iso: string): Date {
  // parse as UTC midnight so day-of-week math isn't affected by the host's
  // local timezone
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date: ${iso}`);
  }
  return date;
}

/** Inclusive list of ISO dates between start and end that fall on a weekday. */
export function businessDaysBetween(startISO: string, endISO: string): string[] {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const days: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (weekday !== 0 && weekday !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
  }
  return days;
}

export type DailyHours = { date: string; hours: number };

/**
 * Per-day hours for an ordered business-day list: partial hours only ever
 * apply to the first and last day, every day strictly between is a full
 * FULL_DAY_HOURS day.
 */
export function dailyHours(businessDays: string[], hoursFirstDay: number, hoursLastDay: number): DailyHours[] {
  if (businessDays.length === 0) return [];
  if (businessDays.length === 1) return [{ date: businessDays[0], hours: hoursFirstDay }];
  return businessDays.map((date, i) => ({
    date,
    hours: i === 0 ? hoursFirstDay : i === businessDays.length - 1 ? hoursLastDay : FULL_DAY_HOURS,
  }));
}

export type HoursValidationError = "invalid_range" | "no_business_days" | "invalid_hours";

export type ComputeHoursResult =
  | { ok: true; hoursRequested: number; businessDays: string[] }
  | { ok: false; error: HoursValidationError };

/**
 * Total hours requested across a date range, where weekends don't count and
 * partial hours only ever apply to the first and last *business* day in the
 * range. Every business day strictly between them is a full 7-hour day.
 */
export function computeHoursRequested(
  startISO: string,
  endISO: string,
  hoursFirstDay: number,
  hoursLastDay: number,
): ComputeHoursResult {
  if (endISO < startISO) {
    return { ok: false, error: "invalid_range" };
  }
  if (
    !Number.isFinite(hoursFirstDay) ||
    !Number.isFinite(hoursLastDay) ||
    hoursFirstDay <= 0 ||
    hoursFirstDay > FULL_DAY_HOURS ||
    hoursLastDay <= 0 ||
    hoursLastDay > FULL_DAY_HOURS
  ) {
    return { ok: false, error: "invalid_hours" };
  }

  const businessDays = businessDaysBetween(startISO, endISO);
  if (businessDays.length === 0) {
    return { ok: false, error: "no_business_days" };
  }

  const hoursRequested = dailyHours(businessDays, hoursFirstDay, hoursLastDay).reduce(
    (sum, d) => sum + d.hours,
    0,
  );

  return { ok: true, hoursRequested, businessDays };
}

/**
 * Sums, per calendar date, the hours a set of existing requests already
 * consume — a day untouched by any of them is simply absent from the map
 * (equivalent to 0 used). Pure: takes plain date-range/hours fields, not a
 * DB row, so it composes with dailyHours() for any request-shaped object.
 */
export function usedHoursByDate(
  requests: { startDate: string; endDate: string; hoursFirstDay: number; hoursLastDay: number }[],
): Map<string, number> {
  const used = new Map<string, number>();
  for (const r of requests) {
    for (const day of dailyHours(businessDaysBetween(r.startDate, r.endDate), r.hoursFirstDay, r.hoursLastDay)) {
      used.set(day.date, (used.get(day.date) ?? 0) + day.hours);
    }
  }
  return used;
}

/**
 * Fits a request's own per-day hours into whatever's still available once
 * other requests' usage (usedHoursByDate) is taken into account, returning
 * however many separate requests it takes to represent the result:
 * - a day that's already fully used (no hours left in FULL_DAY_HOURS) is
 *   dropped entirely;
 * - a day that's only partially used gets its hours capped to what's left,
 *   and always becomes its own single-day request — a day that's part-used
 *   can never be a full "every day in the middle is 7h" day of a longer
 *   one, but a single-day request can be any amount in (0, FULL_DAY_HOURS];
 * - a day that's entirely free continues whatever run is being built, at
 *   its own originally-requested hours (unchanged).
 *
 * This is a strict generalization of the old "exclude the whole day or
 * keep it" rule (which is just this with every day's usage at exactly 0 or
 * exactly FULL_DAY_HOURS, never in between) — it's what lets extending an
 * existing partial-day request (e.g. topping up an approved 4h Medical
 * Leave day to the remaining 3h) work as a new, separate request instead of
 * being blocked outright or silently discarding the still-available hours.
 */
export function capToAvailableHours(daily: DailyHours[], usedHoursByDate: ReadonlyMap<string, number>): DailyHours[][] {
  const segments: DailyHours[][] = [];
  let current: DailyHours[] = [];
  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const day of daily) {
    const available = FULL_DAY_HOURS - (usedHoursByDate.get(day.date) ?? 0);
    if (available <= 0) {
      flush();
      continue;
    }
    if (available < FULL_DAY_HOURS) {
      flush();
      segments.push([{ date: day.date, hours: Math.min(day.hours, available) }]);
      continue;
    }
    current.push(day);
  }
  flush();
  return segments;
}

/** Turns one contiguous run of per-day hours back into row-shaped fields. */
export function summarizeDailyHours(daily: DailyHours[]): {
  startDate: string;
  endDate: string;
  hoursFirstDay: number;
  hoursLastDay: number;
  hoursRequested: number;
} {
  return {
    startDate: daily[0].date,
    endDate: daily[daily.length - 1].date,
    hoursFirstDay: daily[0].hours,
    hoursLastDay: daily[daily.length - 1].hours,
    hoursRequested: daily.reduce((sum, d) => sum + d.hours, 0),
  };
}
