import { describe, expect, it } from "vitest";
import { businessDaysBetween, computeHoursRequested } from "../src/lib/leave-hours";

// Pure-function tests: no server boot, no database. This file must never
// import src/lib/db.ts (see src/lib/seed-ids.ts's header comment) — that
// would trigger migrate()/seeding against whatever DATABASE_PATH resolves to
// in the vitest process itself.
describe("businessDaysBetween", () => {
  it("keeps only Monday-Friday within an inclusive range", () => {
    // 2026-09-21 is a Monday, 2026-09-25 a Friday
    expect(businessDaysBetween("2026-09-21", "2026-09-25")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
  });

  it("excludes a weekend spanned by the range", () => {
    // Friday 2026-09-25 through Monday 2026-09-28
    expect(businessDaysBetween("2026-09-25", "2026-09-28")).toEqual(["2026-09-25", "2026-09-28"]);
  });

  it("returns an empty list for an all-weekend range", () => {
    // Saturday 2026-09-26 through Sunday 2026-09-27
    expect(businessDaysBetween("2026-09-26", "2026-09-27")).toEqual([]);
  });

  it("returns a single day for a same-day range", () => {
    expect(businessDaysBetween("2026-09-21", "2026-09-21")).toEqual(["2026-09-21"]);
  });
});

describe("computeHoursRequested", () => {
  it("uses only hoursFirstDay for a single business day", () => {
    const result = computeHoursRequested("2026-09-21", "2026-09-21", 3.5, 7);
    expect(result).toEqual({ ok: true, hoursRequested: 3.5, businessDays: ["2026-09-21"] });
  });

  it("sums a full Monday-Friday week at 7h a day", () => {
    const result = computeHoursRequested("2026-09-21", "2026-09-25", 7, 7);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hoursRequested).toBe(35);
  });

  it("splits partial hours across the first and last business day only", () => {
    // Mon-Wed: 2h first day, 4h last day, 1 full day between = 2 + 7 + 4
    const result = computeHoursRequested("2026-09-21", "2026-09-23", 2, 4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hoursRequested).toBe(13);
  });

  it("excludes the weekend from a Friday-to-Monday span", () => {
    const result = computeHoursRequested("2026-09-25", "2026-09-28", 7, 7);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.businessDays).toEqual(["2026-09-25", "2026-09-28"]);
      expect(result.hoursRequested).toBe(14);
    }
  });

  it("rejects a range with zero business days", () => {
    expect(computeHoursRequested("2026-09-26", "2026-09-27", 7, 7)).toEqual({
      ok: false,
      error: "no_business_days",
    });
  });

  it("rejects an end date before the start date", () => {
    expect(computeHoursRequested("2026-09-25", "2026-09-21", 7, 7)).toEqual({
      ok: false,
      error: "invalid_range",
    });
  });

  it("rejects hours outside (0, 7]", () => {
    expect(computeHoursRequested("2026-09-21", "2026-09-21", 0, 7)).toEqual({
      ok: false,
      error: "invalid_hours",
    });
    expect(computeHoursRequested("2026-09-21", "2026-09-21", 7.5, 7)).toEqual({
      ok: false,
      error: "invalid_hours",
    });
  });
});
