# Design record: HORUS-lite leave management

This is the plan this stage was built from, kept in the repo rather than only
in a local planning session, so a marker (or future-me) can see the reasoning
behind the code without reconstructing it from the diff. `CLAUDE.md` holds
the operating rules; this file holds the design itself.

## Context

Crit 7 asks for a full-stack prototype of "the ANU system you wish existed."
The chosen slice is a lightweight clone of ANU's real HORUS leave-management
workflow (a PeopleSoft HCM Absence Management skin), covering the full loop:
employee applies for leave → manager approves/denies → employee can cancel
(before or after approval, with different rules) → manager actions the
cancellation → manager can view an employee's absence history. Real leave
balances decrement on approval and restore on an approved cancellation —
that state-machine behaviour, not just a status log, is the substantive
thing being modelled.

Scope, decided up front rather than assumed:

- No real auth: the landing page (`/`) is a tile per seeded person, labelled
  Employee or Manager, no passwords. Identity travels in the URL path
  (`/ess/[personId]/...`, `/mss/[personId]/...`) — this keeps every spec test
  a plain `fetch()` with no cookie jar, and fits the repo's per-request
  SSR-from-DB pattern.
- Flat org: exactly one manager, every seeded employee reports to them. The
  manager does not submit their own leave in this slice — no ESS tile/route
  for the manager, no leave balances seeded for them.
- Four leave types: Annual Leave, Personal/Carer's Leave, and Medical Leave
  all accrue and check balance; Leave Without Pay does not.
- Weekends are excluded from leave-day counting (business days only).
- Partial days are specified in **hours**, not a half-day boolean. A full
  work day is 7 hours. The first and last business day of a request can each
  be a partial amount (0–7h); every business day strictly between them counts
  as a full 7h.
- Attachments are mocked in the UI only (a disabled file input with
  explanatory text) — no upload/storage, since Fly's filesystem is ephemeral.
- No email notifications — the manager's in-app "Pending Approvals" list is
  the substitute.

This replaced the guestbook starter feature entirely (`spec/README.md` says
`guestbook.test.ts` "goes when the starter does," and `/` is repurposed as
the person picker) — it reuses the starter's patterns (POST-form → 303
redirect → re-render from DB; `db.ts` as the sole query/mutation surface)
but not its code.

## Data model (`src/lib/schema.ts`)

No SQL CHECK constraints (matches the starter's own idiom) — enum/status
safety comes from routing every mutation through the three named `db.ts`
write helpers instead.

```ts
export const people = sqliteTable("people", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  title: text(),
  managerId: int("manager_id").references((): AnySQLiteColumn => people.id),
});

export const leaveTypes = sqliteTable("leave_types", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(), // Annual Leave / Personal/Carer's Leave / Medical Leave / Leave Without Pay
  accrues: int({ mode: "boolean" }).notNull().default(true), // false only for LWOP
});

export const leaveBalances = sqliteTable(
  "leave_balances",
  {
    id: int().primaryKey({ autoIncrement: true }),
    personId: int("person_id").notNull().references(() => people.id),
    leaveTypeId: int("leave_type_id").notNull().references(() => leaveTypes.id),
    balanceHours: real("balance_hours").notNull().default(0),
  },
  (t) => [uniqueIndex("leave_balances_person_type").on(t.personId, t.leaveTypeId)],
);

export const LEAVE_REQUEST_STATUSES = [
  "submitted", "approved", "denied", "cancel_requested", "cancelled",
] as const;

export const leaveRequests = sqliteTable("leave_requests", {
  id: int().primaryKey({ autoIncrement: true }),
  personId: int("person_id").notNull().references(() => people.id),
  leaveTypeId: int("leave_type_id").notNull().references(() => leaveTypes.id),
  startDate: text("start_date").notNull(), // ISO YYYY-MM-DD
  endDate: text("end_date").notNull(),
  hoursFirstDay: real("hours_first_day").notNull(),
  hoursLastDay: real("hours_last_day").notNull(),
  hoursRequested: real("hours_requested").notNull(), // computed at submit time
  reason: text(),
  status: text().notNull().default("submitted"),
  cancellationReason: text("cancellation_reason"),
  decidedBy: int("decided_by").references(() => people.id),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
```

Hours are the canonical unit for both balances and requests — and also the
display unit throughout the UI (balance tiles, request lists, approvals,
history). Not converting to days keeps the number shown always equal to
what actually gets debited/credited; a day figure would just be that same
number divided by 7 for a reader to redo in their head.

Derive "is a manager" from `managerId === null` rather than a stored flag —
there's exactly one manager in this flat org, so it's one source of truth
for the whole hierarchy.

## Business-day / hours helper (`src/lib/leave-hours.ts`)

Pure, side-effect-free (no DB import), so it's safe for both `db.ts` and
spec files to import directly and unit-test in isolation:

- `businessDaysBetween(startISO, endISO)` — inclusive Mon–Fri dates in the
  range.
- `computeHoursRequested(startISO, endISO, hoursFirstDay, hoursLastDay)` —
  validates hours are in `(0, 7]` and the range is non-empty; a single
  business day uses `hoursFirstDay` alone, otherwise
  `hoursFirstDay + hoursLastDay + 7 * (businessDays.length - 2)`. Returns a
  discriminated result (`{ok:false, error: "invalid_range"|"no_business_days"|"invalid_hours"}`)
  rather than throwing, since both the API route and the test suite need to
  branch on *why* it failed.

## Seed identity (`src/lib/seed-ids.ts`)

Zero side effects (no `better-sqlite3` import) — the single source of truth
for seed identity used by both `db.ts` (to seed) and `spec/routes.ts` /
`spec/leave.test.ts` (to reference). This matters because `spec/routes.ts`
is imported directly by `invariants.test.ts` in the vitest process itself,
not through `global-setup.ts`'s spawned child — if it imported `db.ts`, it
would trigger `migrate()`/seeding against the wrong `DATABASE_PATH`
in-process.

## Seeding (`src/lib/db.ts`, gated on an empty table)

`spec/global-setup.ts` boots a fresh, empty tmpdir database on every test
run, so seed data has to be inserted at boot, gated on "the `people` table
is empty" — never via a one-off script. One `db.transaction()` inserts the
manager and three employees with explicit ids (matching `SEED_PEOPLE`), the
four leave types (matching `SEED_LEAVE_TYPES`), and balances for the three
employees only (annual 140h / carer 70h / medical 70h — no manager balance
rows, no LWOP balance row, since LWOP is never checked). No leave requests
are seeded, so both the manual demo and `spec/leave.test.ts` start clean.

## Identity & route guards

- Any dynamic route with an unknown `personId` redirects to `/`.
- An ESS route visited by the manager (or an MSS route visited by an
  employee) redirects to that person's own home, so a tile never leads
  somewhere inconsistent with the flat-org rule.
- `/mss/[personId]/team/[employeeId]` verifies `employeeId` is a direct
  report of `personId` (`isManagerOf`) before rendering, else redirects to
  `/mss/[personId]/team`.

## Pages

`src/layouts/Base.astro` owns `lang`, `viewport`, `title`, and the one
`<nav aria-label="site">` — every page renders through it so those
structural invariants can't drift as pages are added.

| Route | h1 | Content |
|---|---|---|
| `/` | "Absence Management" | tile grid, one tile per person, ESS or MSS link depending on `managerId === null` |
| `/ess/[personId]` | person's name | "Absences" tile → real link; inert decorative tiles (Payslips, Personal Details) for PeopleSoft flavour |
| `/ess/[personId]/absences` | "Manage Absences" | balance tiles (**hours**, matching the unit the balance is actually tracked and checked in), apply-absence form with a live hours-counted-towards-balance readout, request list with status badges, `?error=` banner |
| `/ess/[personId]/absences/cancel` | "Cancel Absences" | one form per cancellable request (`submitted` or `approved`), mandatory reason |
| `/mss/[personId]` | "Manager Self Service" | Approvals + My Team tiles |
| `/mss/[personId]/approvals` | "Pending Approvals" | one form per pending row (leave requests **and** cancel requests, labelled distinctly), two named submit buttons |
| `/mss/[personId]/team` | "My Team" | direct-report list, links to each one's history |
| `/mss/[personId]/team/[employeeId]` | "{name}'s Absence History" | full status history, read-only, guarded by `isManagerOf` |

Per-row actions with no client JS use the multi-submit-button trick:
```html
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
```

Error banners: mutating routes redirect back to the originating page with
`?error=<code>` (`insufficient_balance`, `no_business_days`, `invalid_hours`,
`not_cancellable`, ...); `src/lib/error-messages.ts` maps the code to a
message at render time. Keeps the POST→redirect→re-render pattern intact,
no session state — and on failure the submitted field values ride along on
the same query string (`leaveTypeId`, `startDate`, `endDate`,
`hoursFirstDay`, `hoursLastDay`, `reason` for submit; `requestId`,
`cancellationReason` for cancel), so a rejected request re-renders the form
as the user left it rather than resetting it.

The apply form also has one small, deliberate piece of client JS: as the
user fills in the date/hours fields, it calls `GET /api/leave/preview`
(a thin wrapper around `computeHoursRequested` — no arithmetic duplicated
client-side) and shows a prominent `.hours-preview` readout of how many
hours/business-days the request will actually count, before they submit.
This is the one page where "no client JS" was worth breaking:
real HORUS calculates duration live the same way, and it's the detail most
likely to surprise someone unfamiliar with the business-day/partial-hours
model. It degrades harmlessly with JS off — the readout just never appears,
and submitting still works.

## `db.ts` helpers and API routes

```ts
listPeople(): Person[]
getPerson(id): Person | undefined
isManager(person): boolean                 // managerId === null
listDirectReports(managerId): Person[]
isManagerOf(managerId, employeeId): boolean
listLeaveTypes(): LeaveType[]
listBalances(personId): (LeaveBalance & { leaveType })[]
listRequestsForPerson(personId): (LeaveRequest & { leaveType })[]   // all statuses; ESS list + MSS history
listCancellableRequests(personId)                                  // submitted | approved
listPendingApprovalsForManager(managerId): (... & { person; kind: "leave_request" | "cancel_absence" })[]

submitLeaveRequest(input): Result<LeaveRequest>
// computes hoursRequested via computeHoursRequested(); insufficient balance
// or an empty business-day range fails before any row is written; balance
// is NOT decremented here — only on manager approval

cancelLeaveRequest(input): Result<LeaveRequest>
// "submitted" -> "cancelled" immediately, no balance change
// "approved"  -> "cancel_requested" (enters the manager's queue as a Cancel Absence)
// else        -> not_cancellable

decideLeaveRequest(input): Result<LeaveRequest>
// "submitted" + approve        -> "approved", decrement balance
// "submitted" + deny           -> "denied"
// "cancel_requested" + approve -> "cancelled", restore balance
// "cancel_requested" + deny    -> "approved" (revert), no balance change
```

Each mutating helper wraps its read+write in one `db.transaction()` so a
double-click or two open tabs can't double-apply a decision. API routes
(`src/pages/api/leave/submit.ts`, `cancel.ts`, `decide.ts`) are thin
`POST: APIRoute` wrappers around these, same shape as the starter's
`api/messages.ts`. `src/pages/api/leave/preview.ts` is a fourth, read-only
`GET: APIRoute` — it wraps `computeHoursRequested` as JSON for the apply
form's live readout (see Pages, above) rather than a mutation.

## Testing strategy

The brief itself sets no automated-test bar — grading is against the live
deployed behaviour — but the repo's own shipped contract
(`spec/invariants.test.ts` + `spec/routes.ts`) already commits to more than
that, so this stage doesn't stop at "the brief doesn't require it." Two
files, for two different things:

- **`spec/leave-hours.test.ts`** — direct unit tests of the pure functions
  in `leave-hours.ts` (same-day partial request, a full Mon–Fri week, a
  Friday-to-Monday span with the weekend excluded, an all-weekend range,
  hours outside `(0, 7]`). No server boot, no DB — cheap and precise for the
  trickiest arithmetic in the feature.
- **`spec/leave.test.ts`** — proves the state machine end to end through the
  real running app (mirrors the starter's `guestbook.test.ts` shape: shared
  `post()` helper with the `Origin` header, `redirect: "manual"`, sequential
  dependent `it()`s). Walks submit → view → manager sees "Leave Request" →
  approve → balance decrements → cancel → manager sees "Cancel Absence" →
  approve the cancellation → balance restored → history retains the
  cancelled entry, plus two negative-path cases (insufficient balance,
  no business days in range).

`invariants.test.ts` (via the routes added to `spec/routes.ts`) proves the
*pages* meet the platform's structural and accessibility floor;
`leave.test.ts` / `leave-hours.test.ts` prove the *workflow* is correct.
Neither substitutes for the other.

## Deliberate simplifications

Recorded here (and in `README.md`) so a marker who knows the real ANU system
reads these as decisions, not bugs:

- Weekend-only business-day counting — no public-holiday calendar.
- A single decision per request (no multi-level approval, no delegate
  approvers) — matches the flat org.
- Attachments are mocked UI only; nothing is actually stored.
- No real auth; identity is a URL path segment, chosen from an unlocked tile.
