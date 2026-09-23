import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { computeHoursRequested } from "./leave-hours";
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

    const adjustBalance = (delta: number) => {
      if (!leaveType?.accrues) return;
      const balance = tx
        .select()
        .from(leaveBalances)
        .where(
          and(eq(leaveBalances.personId, existing.personId), eq(leaveBalances.leaveTypeId, existing.leaveTypeId)),
        )
        .get();
      const available = balance?.balanceHours ?? 0;
      tx.update(leaveBalances)
        .set({ balanceHours: available + delta })
        .where(
          and(eq(leaveBalances.personId, existing.personId), eq(leaveBalances.leaveTypeId, existing.leaveTypeId)),
        )
        .run();
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
      adjustBalance(-existing.hoursRequested);

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

      adjustBalance(existing.hoursRequested);

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
