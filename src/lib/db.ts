import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  businessDaysBetween,
  computeHoursRequested,
  dailyHours,
  excludeBusinessDays,
  summarizeBusinessDays,
} from "./leave-hours";
import {
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
  type Person,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  people,
} from "./schema";
import { SEED_BALANCE_HOURS, SEED_LEAVE_TYPES, SEED_PEOPLE } from "./seed-ids";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

export type { Person, LeaveType, LeaveBalance, LeaveRequest };
export type { LeaveRequestStatus } from "./schema";

// Seed data ----------------------------------------------------------------
// spec/global-setup.ts boots the built server against a brand-new throwaway
// database on every test run, so seed data has to be inserted here, at boot,
// gated on "table is empty" — never via a one-off script.
function seedIfEmpty(): void {
  if (db.select().from(people).limit(1).all().length > 0) return;

  db.transaction((tx) => {
    tx.insert(people)
      .values({ id: SEED_PEOPLE.manager, name: "Morgan Reyes", title: "Manager", managerId: null })
      .run();
    tx.insert(people)
      .values([
        {
          id: SEED_PEOPLE.employeeA,
          name: "Sam Chen",
          title: "Software Engineer",
          managerId: SEED_PEOPLE.manager,
        },
        {
          id: SEED_PEOPLE.employeeB,
          name: "Priya Nair",
          title: "Research Officer",
          managerId: SEED_PEOPLE.manager,
        },
        {
          id: SEED_PEOPLE.employeeC,
          name: "Alex Rivera",
          title: "Systems Administrator",
          managerId: SEED_PEOPLE.manager,
        },
      ])
      .run();

    tx.insert(leaveTypes)
      .values([
        { id: SEED_LEAVE_TYPES.annual, name: "Annual Leave", accrues: true },
        { id: SEED_LEAVE_TYPES.carer, name: "Personal/Carer's Leave", accrues: true },
        { id: SEED_LEAVE_TYPES.medical, name: "Medical Leave", accrues: true },
        { id: SEED_LEAVE_TYPES.lwop, name: "Leave Without Pay", accrues: false },
      ])
      .run();

    // Balances only for employees — the manager doesn't submit their own
    // leave in this slice, so they get no balance rows. No balance row for
    // LWOP either: it isn't checked, so there's nothing to track.
    const employeeIds: number[] = [SEED_PEOPLE.employeeA, SEED_PEOPLE.employeeB, SEED_PEOPLE.employeeC];
    tx.insert(leaveBalances)
      .values(
        employeeIds.flatMap((personId) => [
          { personId, leaveTypeId: SEED_LEAVE_TYPES.annual, balanceHours: SEED_BALANCE_HOURS.annual },
          { personId, leaveTypeId: SEED_LEAVE_TYPES.carer, balanceHours: SEED_BALANCE_HOURS.carer },
          { personId, leaveTypeId: SEED_LEAVE_TYPES.medical, balanceHours: SEED_BALANCE_HOURS.medical },
        ]),
      )
      .run();
  });
}
seedIfEmpty();

// Reads ----------------------------------------------------------------------

export function listPeople(): Person[] {
  return db.select().from(people).all();
}

export function getPerson(id: number): Person | undefined {
  return db.select().from(people).where(eq(people.id, id)).get();
}

/** managerId === null identifies the (single) manager in this flat org. */
export function isManager(person: Person): boolean {
  return person.managerId === null;
}

export function listDirectReports(managerId: number): Person[] {
  return db.select().from(people).where(eq(people.managerId, managerId)).all();
}

export function isManagerOf(managerId: number, employeeId: number): boolean {
  return (
    db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, employeeId), eq(people.managerId, managerId)))
      .get() !== undefined
  );
}

export function listLeaveTypes(): LeaveType[] {
  return db.select().from(leaveTypes).all();
}

export function getLeaveType(id: number): LeaveType | undefined {
  return db.select().from(leaveTypes).where(eq(leaveTypes.id, id)).get();
}

export type BalanceWithType = LeaveBalance & { leaveType: LeaveType };

export function listBalances(personId: number): BalanceWithType[] {
  return db
    .select({ balance: leaveBalances, leaveType: leaveTypes })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
    .where(eq(leaveBalances.personId, personId))
    .all()
    .map(({ balance, leaveType }) => ({ ...balance, leaveType }));
}

export type RequestWithType = LeaveRequest & { leaveType: LeaveType };

export function listRequestsForPerson(personId: number): RequestWithType[] {
  return db
    .select({ request: leaveRequests, leaveType: leaveTypes })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.personId, personId))
    .orderBy(desc(leaveRequests.id))
    .all()
    .map(({ request, leaveType }) => ({ ...request, leaveType }));
}

export function listCancellableRequests(personId: number): RequestWithType[] {
  return listRequestsForPerson(personId).filter(
    (r) => r.status === "submitted" || r.status === "approved",
  );
}

export type PendingApproval = RequestWithType & {
  person: Person;
  kind: "leave_request" | "cancel_absence";
};

export function listPendingApprovalsForManager(managerId: number): PendingApproval[] {
  return db
    .select({ request: leaveRequests, leaveType: leaveTypes, person: people })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .innerJoin(people, eq(leaveRequests.personId, people.id))
    .where(
      and(
        eq(people.managerId, managerId),
        inArray(leaveRequests.status, ["submitted", "cancel_requested"]),
      ),
    )
    .orderBy(desc(leaveRequests.id))
    .all()
    .map(({ request, leaveType, person }) => ({
      ...request,
      leaveType,
      person,
      kind: (request.status === "cancel_requested" ? "cancel_absence" : "leave_request") as
        | "cancel_absence"
        | "leave_request",
    }));
}

export function getRequestById(requestId: number): RequestWithType | undefined {
  const row = db
    .select({ request: leaveRequests, leaveType: leaveTypes })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.id, requestId))
    .get();
  return row ? { ...row.request, leaveType: row.leaveType } : undefined;
}

// A request still consumes/reserves balance (or is on its way to) in any of
// these statuses — only "denied"/"cancelled" are inert and excluded from
// overlap detection.
export const ACTIVE_LEAVE_STATUSES = ["submitted", "approved", "cancel_requested"] as const;

export function listActiveOverlappingRequests(personId: number, startDate: string, endDate: string): RequestWithType[] {
  return db
    .select({ request: leaveRequests, leaveType: leaveTypes })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(
      and(
        eq(leaveRequests.personId, personId),
        inArray(leaveRequests.status, ACTIVE_LEAVE_STATUSES),
        lte(leaveRequests.startDate, endDate),
        gte(leaveRequests.endDate, startDate),
      ),
    )
    .orderBy(leaveRequests.id)
    .all()
    .map(({ request, leaveType }) => ({ ...request, leaveType }));
}

// Overlap planning ---------------------------------------------------------
// Read-only: figures out what a new submission would need to do, before
// anything gets written. The employee confirms the outcome (see
// src/pages/api/leave/submit-confirm.ts) before submitLeaveRequest ever runs.

export type TrimmedRequest = {
  startDate: string;
  endDate: string;
  hoursFirstDay: number;
  hoursLastDay: number;
  hoursRequested: number;
};

export type LeaveSubmissionPlan =
  | { kind: "invalid"; error: string }
  | { kind: "none" }
  // Every business day is already booked under some existing request —
  // there's no difference left to work out, so this is a hard error rather
  // than something to confirm.
  | { kind: "fully_covered" }
  // The overlap can't be reduced to one contiguous remaining run (a "middle
  // carve-out" — days left on both sides). Scope cut: offer only a plain
  // "submit the full amount anyway?" confirmation.
  | { kind: "unresolvable"; overlapRequestId: number; overlapCount: number }
  // The default outcome for any overlap that CAN be resolved to a single
  // difference: trimmed always holds the non-overlapping hours/dates,
  // computed from the union of every overlapping request's days regardless
  // of leave type.
  | { kind: "overlap"; overlapRequestId: number; overlapCount: number; trimmed: TrimmedRequest }
  // Medical Leave overlapping exactly one Annual Leave request specifically
  // also gets the option to convert those days instead of just adding to
  // them. `trimmed` (the "extra hours only" alternative) is present unless
  // the overlap can't be cleanly reduced to one run.
  | { kind: "medical_replace_candidate"; overlapRequestId: number; trimmed?: TrimmedRequest };

export function planLeaveSubmission(input: {
  personId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  hoursFirstDay: number;
  hoursLastDay: number;
}): LeaveSubmissionPlan {
  const leaveType = getLeaveType(input.leaveTypeId);
  if (!leaveType) return { kind: "invalid", error: "invalid_input" };
  const accrues = leaveType.accrues;

  function checkBalance(outcome: LeaveSubmissionPlan, hoursToCheck: number): LeaveSubmissionPlan {
    if (!accrues) return outcome;
    const balance = listBalances(input.personId).find((b) => b.leaveTypeId === input.leaveTypeId);
    if ((balance?.balanceHours ?? 0) < hoursToCheck) return { kind: "invalid", error: "insufficient_balance" };
    return outcome;
  }

  const computed = computeHoursRequested(input.startDate, input.endDate, input.hoursFirstDay, input.hoursLastDay);
  if (!computed.ok) return { kind: "invalid", error: computed.error };

  const overlaps = listActiveOverlappingRequests(input.personId, input.startDate, input.endDate);
  if (overlaps.length === 0) return checkBalance({ kind: "none" }, computed.hoursRequested);

  const original = dailyHours(computed.businessDays, input.hoursFirstDay, input.hoursLastDay);

  // Medical Leave replacing a single overlapping Annual Leave request is
  // always offered, even when the new request's range fully consumes the
  // annual one (the common "sick for my whole holiday" case) — so this is
  // checked before the generic difference below, not instead of it.
  if (overlaps.length === 1 && leaveType.id === SEED_LEAVE_TYPES.medical && overlaps[0].leaveTypeId === SEED_LEAVE_TYPES.annual) {
    const annual = overlaps[0];
    const annualDays = new Set(businessDaysBetween(annual.startDate, annual.endDate));
    const excluded = excludeBusinessDays(computed.businessDays, annualDays);
    const trimmed = excluded.kind === "trimmed" ? summarizeBusinessDays(excluded.businessDays, original) : undefined;
    // Checked against the full entered hours (a safe upper bound: the
    // trimmed alternative is always <=): submitLeaveRequest re-validates
    // whichever amount is actually chosen at write time regardless.
    return checkBalance({ kind: "medical_replace_candidate", overlapRequestId: annual.id, trimmed }, computed.hoursRequested);
  }

  // Generic case: work out the difference against the UNION of every
  // overlapping request's business days, regardless of leave type — so an
  // overlap never just falls back to "continue with the full hours" when a
  // clean adjustment is actually possible.
  const excludeDates = new Set(overlaps.flatMap((o) => businessDaysBetween(o.startDate, o.endDate)));
  const excluded = excludeBusinessDays(computed.businessDays, excludeDates);
  const overlapRequestId = overlaps[0].id;
  const overlapCount = overlaps.length;

  if (excluded.kind === "unchanged") return checkBalance({ kind: "none" }, computed.hoursRequested);
  if (excluded.kind === "fully_covered") return { kind: "fully_covered" };
  if (excluded.kind === "requires_split") {
    return checkBalance({ kind: "unresolvable", overlapRequestId, overlapCount }, computed.hoursRequested);
  }

  const trimmed = summarizeBusinessDays(excluded.businessDays, original);
  return checkBalance({ kind: "overlap", overlapRequestId, overlapCount, trimmed }, trimmed.hoursRequested);
}

// Writes -----------------------------------------------------------------

export type Result<T> = { ok: true; request: T } | { ok: false; error: string };

export function submitLeaveRequest(input: {
  personId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  hoursFirstDay: number;
  hoursLastDay: number;
  reason?: string;
  systemNote?: string | null;
  replacesRequestId?: number | null;
}): Result<LeaveRequest> {
  const leaveType = getLeaveType(input.leaveTypeId);
  if (!leaveType) return { ok: false, error: "invalid_input" };

  const computed = computeHoursRequested(
    input.startDate,
    input.endDate,
    input.hoursFirstDay,
    input.hoursLastDay,
  );
  if (!computed.ok) return { ok: false, error: computed.error };

  return db.transaction((tx) => {
    if (leaveType.accrues) {
      const balance = tx
        .select()
        .from(leaveBalances)
        .where(
          and(eq(leaveBalances.personId, input.personId), eq(leaveBalances.leaveTypeId, input.leaveTypeId)),
        )
        .get();
      const available = balance?.balanceHours ?? 0;
      if (available < computed.hoursRequested) {
        return { ok: false, error: "insufficient_balance" } as const;
      }
    }

    const request = tx
      .insert(leaveRequests)
      .values({
        personId: input.personId,
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        hoursFirstDay: input.hoursFirstDay,
        hoursLastDay: input.hoursLastDay,
        hoursRequested: computed.hoursRequested,
        reason: input.reason?.trim() || null,
        status: "submitted",
        systemNote: input.systemNote?.trim() || null,
        replacesRequestId: input.replacesRequestId ?? null,
      })
      .returning()
      .get();

    return { ok: true, request } as const;
  });
}

export function cancelLeaveRequest(input: {
  requestId: number;
  personId: number;
  cancellationReason: string;
}): Result<LeaveRequest> {
  const reason = input.cancellationReason.trim();
  if (!reason) return { ok: false, error: "reason_required" };

  return db.transaction((tx) => {
    const existing = tx.select().from(leaveRequests).where(eq(leaveRequests.id, input.requestId)).get();
    if (!existing || existing.personId !== input.personId) {
      return { ok: false, error: "not_cancellable" } as const;
    }

    let nextStatus: "cancelled" | "cancel_requested";
    if (existing.status === "submitted") {
      nextStatus = "cancelled";
    } else if (existing.status === "approved") {
      nextStatus = "cancel_requested";
    } else {
      return { ok: false, error: "not_cancellable" } as const;
    }

    const request = tx
      .update(leaveRequests)
      .set({ status: nextStatus, cancellationReason: reason })
      .where(eq(leaveRequests.id, input.requestId))
      .returning()
      .get();

    return { ok: true, request } as const;
  });
}

export function decideLeaveRequest(input: {
  requestId: number;
  managerId: number;
  decision: "approve" | "deny";
}): Result<LeaveRequest> {
  return db.transaction((tx) => {
    const existing = tx.select().from(leaveRequests).where(eq(leaveRequests.id, input.requestId)).get();
    if (!existing || !isManagerOf(input.managerId, existing.personId)) {
      return { ok: false, error: "not_authorized" } as const;
    }

    const leaveType = tx.select().from(leaveTypes).where(eq(leaveTypes.id, existing.leaveTypeId)).get();
    const decidedAt = new Date().toISOString();

    // Generalized so the medical-replaces-annual block below can restore
    // balance for a SECOND request's leave type, not just existing's own.
    const adjustBalance = (personId: number, leaveTypeId: number, delta: number) => {
      const balance = tx
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.personId, personId), eq(leaveBalances.leaveTypeId, leaveTypeId)))
        .get();
      const available = balance?.balanceHours ?? 0;
      tx.update(leaveBalances)
        .set({ balanceHours: available + delta })
        .where(and(eq(leaveBalances.personId, personId), eq(leaveBalances.leaveTypeId, leaveTypeId)))
        .run();
    };

    // If this medical-leave request replaces an overlapping Annual Leave
    // request (see planLeaveSubmission), trim/cancel that request and
    // restore its balance now — deferred to approve-time (not confirm-time)
    // so a denied medical request leaves the annual request untouched.
    const applyReplace = () => {
      if (existing.replacesRequestId == null) return;
      const annual = tx.select().from(leaveRequests).where(eq(leaveRequests.id, existing.replacesRequestId)).get();
      if (!annual || (annual.status !== "submitted" && annual.status !== "approved")) return;

      const annualDays = businessDaysBetween(annual.startDate, annual.endDate);
      const excluded = excludeBusinessDays(annualDays, new Set(businessDaysBetween(existing.startDate, existing.endDate)));

      if (excluded.kind === "fully_covered") {
        // Annual Leave always accrues in this org — no accrues check needed.
        if (annual.status === "approved") adjustBalance(annual.personId, annual.leaveTypeId, annual.hoursRequested);
        tx.update(leaveRequests)
          .set({
            status: "cancelled",
            cancellationReason: `Replaced by Medical Leave request #${existing.id}, approved by the manager.`,
          })
          .where(eq(leaveRequests.id, annual.id))
          .run();
      } else if (excluded.kind === "trimmed") {
        const shrunk = summarizeBusinessDays(
          excluded.businessDays,
          dailyHours(annualDays, annual.hoursFirstDay, annual.hoursLastDay),
        );
        const restored = annual.hoursRequested - shrunk.hoursRequested;
        if (annual.status === "approved" && restored > 0) {
          adjustBalance(annual.personId, annual.leaveTypeId, restored);
        }
        tx.update(leaveRequests)
          .set({
            ...shrunk,
            systemNote:
              `Adjusted: ${restored.toFixed(1)}h excluded — Medical Leave request #${existing.id} ` +
              `was approved for ${existing.startDate} to ${existing.endDate}. Originally ${annual.startDate} to ${annual.endDate}.`,
          })
          .where(eq(leaveRequests.id, annual.id))
          .run();
      }
      // "unchanged"/"requires_split": geometry can't have changed between
      // confirm and decide, so these are unreachable in the normal flow —
      // defensively, just skip the annual mutation if we somehow hit them.
    };

    if (existing.status === "submitted") {
      if (input.decision === "deny") {
        const request = tx
          .update(leaveRequests)
          .set({ status: "denied", decidedBy: input.managerId, decidedAt })
          .where(eq(leaveRequests.id, input.requestId))
          .returning()
          .get();
        return { ok: true, request } as const;
      }

      if (leaveType?.accrues) {
        const balance = tx
          .select()
          .from(leaveBalances)
          .where(
            and(eq(leaveBalances.personId, existing.personId), eq(leaveBalances.leaveTypeId, existing.leaveTypeId)),
          )
          .get();
        if ((balance?.balanceHours ?? 0) < existing.hoursRequested) {
          return { ok: false, error: "insufficient_balance" } as const;
        }
      }
      if (leaveType?.accrues) adjustBalance(existing.personId, existing.leaveTypeId, -existing.hoursRequested);
      applyReplace();

      const request = tx
        .update(leaveRequests)
        .set({ status: "approved", decidedBy: input.managerId, decidedAt })
        .where(eq(leaveRequests.id, input.requestId))
        .returning()
        .get();
      return { ok: true, request } as const;
    }

    if (existing.status === "cancel_requested") {
      if (input.decision === "deny") {
        const request = tx
          .update(leaveRequests)
          .set({ status: "approved", decidedBy: input.managerId, decidedAt })
          .where(eq(leaveRequests.id, input.requestId))
          .returning()
          .get();
        return { ok: true, request } as const;
      }

      if (leaveType?.accrues) adjustBalance(existing.personId, existing.leaveTypeId, existing.hoursRequested);

      const request = tx
        .update(leaveRequests)
        .set({ status: "cancelled", decidedBy: input.managerId, decidedAt })
        .where(eq(leaveRequests.id, input.requestId))
        .returning()
        .get();
      return { ok: true, request } as const;
    }

    return { ok: false, error: "not_pending" } as const;
  });
}
