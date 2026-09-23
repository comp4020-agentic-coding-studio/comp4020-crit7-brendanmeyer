import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  computeHoursRequested,
  dailyHours,
  splitBusinessDays,
  summarizeBusinessDays,
} from "../src/lib/leave-hours";

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

// 2026-09-21..25 is a Monday-Friday week, used as the fixture business-day
// list for the overlap-detection helpers below.
const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];

describe("dailyHours", () => {
  it("uses only hoursFirstDay for a single day", () => {
    expect(dailyHours(["2026-09-21"], 3.5, 7)).toEqual([{ date: "2026-09-21", hours: 3.5 }]);
  });

  it("gives every strictly-interior day a full FULL_DAY_HOURS", () => {
    expect(dailyHours(WEEK, 2, 4)).toEqual([
      { date: "2026-09-21", hours: 2 },
      { date: "2026-09-22", hours: 7 },
      { date: "2026-09-23", hours: 7 },
      { date: "2026-09-24", hours: 7 },
      { date: "2026-09-25", hours: 4 },
    ]);
  });

  it("uses only first/last hours for a two-day range, no interior day", () => {
    expect(dailyHours(["2026-09-21", "2026-09-22"], 2, 4)).toEqual([
      { date: "2026-09-21", hours: 2 },
      { date: "2026-09-22", hours: 4 },
    ]);
  });
});

describe("splitBusinessDays", () => {
  it("returns the original list untouched as one run when nothing is excluded", () => {
    expect(splitBusinessDays(WEEK, new Set(["2026-10-01", "2026-10-02"]))).toEqual([WEEK]);
  });

  it("returns no runs when every day is excluded", () => {
    expect(splitBusinessDays(WEEK, new Set(WEEK))).toEqual([]);
  });

  it("returns one run — the prefix — when a suffix is excluded", () => {
    expect(splitBusinessDays(WEEK, new Set(["2026-09-24", "2026-09-25"]))).toEqual([
      ["2026-09-21", "2026-09-22", "2026-09-23"],
    ]);
  });

  it("returns one run — the suffix — when a prefix is excluded", () => {
    expect(splitBusinessDays(WEEK, new Set(["2026-09-21", "2026-09-22"]))).toEqual([
      ["2026-09-23", "2026-09-24", "2026-09-25"],
    ]);
  });

  it("splits into two runs when a middle day is excluded (extra days before AND after)", () => {
    // e.g. Wednesday is already booked; applying for the whole week splits
    // into "Mon-Tue" and "Thu-Fri" instead of being rejected outright.
    expect(splitBusinessDays(WEEK, new Set(["2026-09-23"]))).toEqual([
      ["2026-09-21", "2026-09-22"],
      ["2026-09-24", "2026-09-25"],
    ]);
  });

  it("can split around the union of dates from more than one other request", () => {
    // Two separate existing requests, one covering Monday and one covering
    // Friday, leave only the middle three days as a single run.
    expect(splitBusinessDays(WEEK, new Set(["2026-09-21", "2026-09-25"]))).toEqual([
      ["2026-09-22", "2026-09-23", "2026-09-24"],
    ]);
    // Three separate excluded days scattered through the week leave three
    // separate single-day runs.
    expect(splitBusinessDays(WEEK, new Set(["2026-09-21", "2026-09-23", "2026-09-25"]))).toEqual([
      ["2026-09-22"],
      ["2026-09-24"],
    ]);
  });
});

describe("summarizeBusinessDays", () => {
  it("reassigns the new boundary day's hours instead of reusing the stale original boundary value", () => {
    // hoursFirstDay=7, hoursLastDay=4: Mon-Thu are all 7h, Fri is 4h.
    const original = dailyHours(WEEK, 7, 4);
    const trimmed = summarizeBusinessDays(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"], original);
    expect(trimmed).toEqual({
      startDate: "2026-09-21",
      endDate: "2026-09-24",
      hoursFirstDay: 7,
      hoursLastDay: 7, // Thursday's own (full-day) hours, not Friday's stale 4h
      hoursRequested: 28,
    });
  });

  it("picks up a single remaining day's own hours for both first and last", () => {
    // hoursFirstDay=2, hoursLastDay=4 across a 3-day range: Mon=2, Tue=7, Wed=4.
    const original = dailyHours(["2026-09-21", "2026-09-22", "2026-09-23"], 2, 4);
    const single = summarizeBusinessDays(["2026-09-22"], original);
    expect(single).toEqual({
      startDate: "2026-09-22",
      endDate: "2026-09-22",
      hoursFirstDay: 7,
      hoursLastDay: 7,
      hoursRequested: 7,
    });
  });
});
