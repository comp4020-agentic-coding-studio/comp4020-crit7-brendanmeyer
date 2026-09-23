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

  const hoursRequested =
    businessDays.length === 1
      ? hoursFirstDay
      : hoursFirstDay + hoursLastDay + FULL_DAY_HOURS * (businessDays.length - 2);

  return { ok: true, hoursRequested, businessDays };
}

/** Hours -> the "N.N days" figure people are shown. */
export function hoursToDays(hours: number): number {
  return hours / FULL_DAY_HOURS;
}
