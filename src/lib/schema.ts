import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  int,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.

// Flat org: managerId null means this person IS the manager. There is
// exactly one such row in this slice, and the manager has no leave balances
// or requests of their own — see src/lib/db.ts's seed function.
export const people = sqliteTable("people", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  title: text(),
  managerId: int("manager_id").references((): AnySQLiteColumn => people.id),
});

export const leaveTypes = sqliteTable("leave_types", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  // false only for Leave Without Pay: no balance to check, submit always succeeds.
  accrues: int({ mode: "boolean" }).notNull().default(true),
});

export const leaveBalances = sqliteTable(
  "leave_balances",
  {
    id: int().primaryKey({ autoIncrement: true }),
    personId: int("person_id")
      .notNull()
      .references(() => people.id),
    leaveTypeId: int("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    // Hours, not days: canonical unit for both balances and requests, so
    // partial-day sums never need repeated day<->hour rounding. Displayed
    // to people as days (hours / 7).
    balanceHours: real("balance_hours").notNull().default(0),
  },
  (t) => [uniqueIndex("leave_balances_person_type").on(t.personId, t.leaveTypeId)],
);

export const LEAVE_REQUEST_STATUSES = [
  "submitted",
  "approved",
  "denied",
  "cancel_requested",
  "cancelled",
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

// status is only ever written by the helpers in src/lib/db.ts
// (submitLeaveRequest / cancelLeaveRequest / decideLeaveRequest) — that's
// what keeps it honest without a SQL CHECK constraint.
export const leaveRequests = sqliteTable("leave_requests", {
  id: int().primaryKey({ autoIncrement: true }),
  personId: int("person_id")
    .notNull()
    .references(() => people.id),
  leaveTypeId: int("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id),
  startDate: text("start_date").notNull(), // ISO YYYY-MM-DD
  endDate: text("end_date").notNull(),
  hoursFirstDay: real("hours_first_day").notNull(),
  hoursLastDay: real("hours_last_day").notNull(),
  hoursRequested: real("hours_requested").notNull(),
  reason: text(),
  status: text().notNull().default("submitted"),
  cancellationReason: text("cancellation_reason"),
  decidedBy: int("decided_by").references(() => people.id),
  decidedAt: text("decided_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Person = typeof people.$inferSelect;
export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
