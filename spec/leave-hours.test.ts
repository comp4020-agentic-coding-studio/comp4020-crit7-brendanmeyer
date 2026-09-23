import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  capToAvailableHours,
  computeHoursRequested,
  dailyHours,
  summarizeDailyHours,
  usedHoursByDate,
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

describe("usedHoursByDate", () => {
  it("maps each existing request's own per-day hours onto its dates", () => {
    // 4h Monday, full 7h Tuesday-Wednesday, 2h Thursday.
    const used = usedHoursByDate([
      { startDate: "2026-09-21", endDate: "2026-09-24", hoursFirstDay: 4, hoursLastDay: 2 },
    ]);
    expect(used).toEqual(
      new Map([
        ["2026-09-21", 4],
        ["2026-09-22", 7],
        ["2026-09-23", 7],
        ["2026-09-24", 2],
      ]),
    );
  });

  it("sums hours from more than one request that land on the same day", () => {
    const used = usedHoursByDate([
      { startDate: "2026-09-21", endDate: "2026-09-21", hoursFirstDay: 4, hoursLastDay: 4 },
      { startDate: "2026-09-21", endDate: "2026-09-22", hoursFirstDay: 2, hoursLastDay: 3 },
    ]);
    expect(used.get("2026-09-21")).toBe(6); // 4 + 2
    expect(used.get("2026-09-22")).toBe(3);
  });
});

describe("capToAvailableHours", () => {
  it("keeps a single run untouched when nothing else uses those days", () => {
    const daily = dailyHours(WEEK, 7, 7);
    expect(capToAvailableHours(daily, new Map())).toEqual([daily]);
  });

  it("drops a day entirely once it's fully used (the old exclude-the-day behaviour)", () => {
    const daily = dailyHours(WEEK, 7, 7);
    const used = new Map([
      ["2026-09-24", 7],
      ["2026-09-25", 7],
    ]);
    expect(capToAvailableHours(daily, used)).toEqual([daily.slice(0, 3)]);
  });

  it("caps a partially-used day to what's left instead of dropping it — extending a 4h day to 7h", () => {
    // The exact "I have an approved 4h Medical Leave day, I want the
    // remaining 3h" case: a single-day request for the full 7h, with 4h
    // already used that day, should be capped to 3h rather than blocked.
    const daily = dailyHours(["2026-09-21"], 7, 7);
    const used = new Map([["2026-09-21", 4]]);
    expect(capToAvailableHours(daily, used)).toEqual([[{ date: "2026-09-21", hours: 3 }]]);
  });

  it("never over-caps: asking for less than what's available needs no capping", () => {
    const daily = dailyHours(["2026-09-21"], 2, 2);
    const used = new Map([["2026-09-21", 4]]); // 3h available, only 2h requested
    expect(capToAvailableHours(daily, used)).toEqual([[{ date: "2026-09-21", hours: 2 }]]);
  });

  it("isolates a partially-used day as its own segment, splitting the run around it", () => {
    // Wednesday already has 4h used (3h still available); the rest of the
    // week is completely free.
    const daily = dailyHours(WEEK, 7, 7);
    const used = new Map([["2026-09-23", 4]]);
    expect(capToAvailableHours(daily, used)).toEqual([
      [
        { date: "2026-09-21", hours: 7 },
        { date: "2026-09-22", hours: 7 },
      ],
      [{ date: "2026-09-23", hours: 3 }],
      [
        { date: "2026-09-24", hours: 7 },
        { date: "2026-09-25", hours: 7 },
      ],
    ]);
  });

  it("returns no segments when every day is fully used", () => {
    const daily = dailyHours(WEEK, 7, 7);
    const used = usedHoursByDate([{ startDate: WEEK[0], endDate: WEEK[4], hoursFirstDay: 7, hoursLastDay: 7 }]);
    expect(capToAvailableHours(daily, used)).toEqual([]);
  });
});

describe("summarizeDailyHours", () => {
  it("turns one contiguous run back into row-shaped start/end/hours fields", () => {
    expect(summarizeDailyHours([{ date: "2026-09-21", hours: 3 }])).toEqual({
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      hoursFirstDay: 3,
      hoursLastDay: 3,
      hoursRequested: 3,
    });
  });

  it("uses each end's own hours and sums the whole run", () => {
    const daily = [
      { date: "2026-09-21", hours: 7 },
      { date: "2026-09-22", hours: 7 },
      { date: "2026-09-23", hours: 3 },
    ];
    expect(summarizeDailyHours(daily)).toEqual({
      startDate: "2026-09-21",
      endDate: "2026-09-23",
      hoursFirstDay: 7,
      hoursLastDay: 3,
      hoursRequested: 17,
    });
  });
});
