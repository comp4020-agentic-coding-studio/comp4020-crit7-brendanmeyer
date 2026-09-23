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
 * Removes every date in excludeDates from businessDays, returning whatever
 * remains as however many contiguous runs it breaks into: [] if everything
 * was excluded, one run if it's a clean prefix/suffix/single-block trim,
 * two or more if the exclusion carves out the middle (or several separate
 * excluded stretches) — each run is still just as representable as a single
 * leave request, so a carve-out becomes several requests rather than a
 * dead end.
 *
 * excludeDates is a set of individual dates rather than a single start/end
 * range so callers can exclude the UNION of several other requests' days at
 * once (not just one), which is what lets overlap detection work out the
 * actual difference instead of falling back to the full entered hours.
 */
export function splitBusinessDays(businessDays: string[], excludeDates: ReadonlySet<string>): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const day of businessDays) {
    if (excludeDates.has(day)) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(day);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Turns a contiguous subset of an original request's business days back
 * into row-shaped fields, using the ORIGINAL per-day hours so a boundary
 * day that used to be a full "middle" day gets FULL_DAY_HOURS, not a stale
 * first/last-day value.
 */
export function summarizeBusinessDays(
  subsetBusinessDays: string[],
  originalDailyHours: DailyHours[],
): { startDate: string; endDate: string; hoursFirstDay: number; hoursLastDay: number; hoursRequested: number } {
  const byDate = new Map(originalDailyHours.map((d) => [d.date, d.hours]));
  const hours = subsetBusinessDays.map((d) => byDate.get(d) ?? 0);
  return {
    startDate: subsetBusinessDays[0],
    endDate: subsetBusinessDays[subsetBusinessDays.length - 1],
    hoursFirstDay: hours[0],
    hoursLastDay: hours[hours.length - 1],
    hoursRequested: hours.reduce((sum, h) => sum + h, 0),
  };
}
