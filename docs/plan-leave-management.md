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
| `/ess/[personId]/absences` | "Manage Absences" | balance tiles (**hours**, matching the unit the balance is actually tracked and checked in), apply-absence form with a live hours-counted-towards-balance readout, an overlap confirm banner when `planLeaveSubmission` flags one, request list with status badges/`systemNote`, `?error=` banner |
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
user fills in the leave type/date/hours fields, it calls `GET
/api/leave/preview` (a thin wrapper around `computeHoursRequested` and
`planLeaveSubmission` — no arithmetic duplicated client-side) and shows two
live readouts: `.hours-preview` (how many hours/business-days the request
will actually count) and `#overlap-preview` (a proactive heads-up if it
overlaps existing leave, and what submitting will offer to do about it) —
both before the employee ever clicks Submit. This is the one page where "no
client JS" was worth breaking: real HORUS calculates duration live the same
way, and both details are the ones most likely to surprise someone
unfamiliar with the business-day/partial-hours model or the overlap
handling. It degrades harmlessly with JS off — the live readouts just never
appear, and the reactive confirm-after-submit flow (see "Overlap detection",
below) still works exactly the same either way.

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

## Overlap detection, splitting, and the Annual→Medical replacement

A later addition: submitting a new request that overlaps one of the
employee's own existing active requests (`submitted`, `approved`, or
`cancel_requested` — not `denied`/`cancelled`) is detected and handled
before anything is written, via a new read-only planner:

```ts
planLeaveSubmission(input): LeaveSubmissionPlan
// "invalid"                   -> same validation/balance errors as before
// "none"                      -> no overlap; submit exactly as entered
// "fully_covered"             -> every business day already booked by some
//                                existing request: plain error, nothing to add
// "overlap"                   -> the default outcome for any overlap that
//                                ISN'T the medical/annual special case below.
//                                Always carries `segments`: the non-
//                                overlapping days as however many separate
//                                requests it takes to represent them —
//                                almost always one, but more than one when
//                                the employee applies for extra days both
//                                BEFORE and AFTER something already booked
//                                (that can't be one contiguous date range).
//                                Computed against the UNION of every
//                                overlapping request's days, regardless of
//                                leave type.
// "medical_replace_candidate" -> new request is Medical Leave overlapping a
//                                single Annual Leave request specifically —
//                                offers to convert the overlapping days, and
//                                ALSO carries `segments` (the "just the
//                                extra days, leave Annual Leave alone"
//                                alternative — possibly more than one, same
//                                as above) whenever there's anything left
//                                over to offer
```

Working out the difference used to be same-type-only, and a "middle
carve-out" (extra days both before and after an existing booking) used to
be an unhandled dead end. Both are now just the normal case: `"overlap"` is
the generic fallback for *any* overlap, and the day-level math always
produces however many contiguous segments the remainder actually breaks
into, rather than giving up when it isn't exactly one.

Three pure helpers in `leave-hours.ts` do the actual day-level arithmetic:
`dailyHours(businessDays, hoursFirstDay, hoursLastDay)` (computeHoursRequested's
per-day breakdown, shared rather than duplicated),
`splitBusinessDays(businessDays, excludeDates: ReadonlySet<string>)` (walks
the list and breaks it at every excluded date, returning however many
contiguous runs remain — `[]` if everything was excluded, one run for a
clean prefix/suffix/single-block trim, two or more for a carve-out; takes a
*set* of individual dates, not a single start/end range, so the planner can
exclude the union of several overlapping requests' days at once), and
`summarizeBusinessDays(subsetDays, originalDailyHours)` (turns one
contiguous run back into row-shaped start/end/hours fields, using each
day's own original hours rather than reapplying stale first/last-day
values). One run per `TrimmedRequest` segment; `submitLeaveRequestSegments`
(db.ts) inserts however many rows that turns out to be, in one transaction
with one balance check against their combined total.

**No overlap outcome writes anything by itself.** `submit.ts` redirects
back to the apply page with `?confirm=<kind>&overlapRequestId=...&<echoed
form fields>` (same query-string round-trip already used for the "keep my
values on failure" behaviour) instead of calling `submitLeaveRequest` —
deliberately *not* carrying the computed segments themselves, since there
can be any number of them. The apply page re-runs `planLeaveSubmission`
itself from the echoed fields to render whatever is currently true (same
principle `submit-confirm.ts` uses before writing), and shows a confirm
banner with the resulting segments described in plain text. The employee
picks an action (`trim`, `replace`, or `as_entered`); `POST
/api/leave/submit-confirm` re-runs `planLeaveSubmission` fresh again (never
trusting anything computed at render time) and only then writes — via
`submitLeaveRequestSegments` for `trim` (one call handles both the
single-segment and multi-segment case), or `submitLeaveRequest` for
`replace`/`as_entered` (always a single row).

**This is also detected proactively, before the employee ever clicks
Submit.** `/api/leave/preview` (already used for the live "N hours will
count" readout) now also takes `personId`/`leaveTypeId` and runs
`planLeaveSubmission`, returning an `overlap` field the apply page's script
renders as a second live banner as the employee fills in the form. The
actual `POST /api/leave/submit` still re-runs the same check as the
authoritative, JS-independent gate — the proactive check is an earlier
heads-up, not a replacement for it, and degrades harmlessly with JS off
(the reactive confirm-after-submit flow still works exactly the same).

**The Annual Leave trim/cancel/split + balance restore for a replacement
only ever happens inside `decideLeaveRequest`, when the manager approves
the Medical Leave request** — never at employee-confirm time. The confirm
step just records `replacesRequestId` on the new Medical request;
approving it is what triggers `decideLeaveRequest` to look up that
request, exclude the now-approved medical dates from its own business
days, and either cancel it outright (nothing left), update it in place
(one run left — recomputing its start/end/hours from its own original
per-day hours), or update it in place for the *first* remaining run and
insert additional rows (cloned from the original's personId/leaveTypeId/
status/decidedBy/decidedAt) for any further ones — the same "however many
segments this turns into" logic as the submit side, just applied to the
request being replaced instead of the new one, and inside the same
transaction as the approval itself. Balance is restored only for whatever
was actually excluded (original hours minus the sum of what remains).
This ordering is deliberate: mutating the annual request earlier (at
confirm-time) would mean a manager who then *denies* the medical request
has already cost the employee their approved annual leave for nothing.
`leaveRequests` gained two nullable columns for this: `replacesRequestId`
(self-FK, set only when the employee picks "replace", never "trim") and
`systemNote` (free text — the actual "notify the manager" mechanism,
rendered on the approvals card and the history/absences views since
there's no real notification channel by design).

**Scope cuts, deliberately**: more than one simultaneous overlapping
request is still handled (the union-of-days exclusion works regardless of
how many contribute), but only ever offers the generic `"overlap"`
adjustment — the medical/annual "replace" special case is only offered
when exactly one request overlaps. Only Medical-over-Annual ever offers
"replace" — no other leave-type pairing does, and it's offered even when
the medical range fully consumes the annual one (in which case there's no
"extra days" trim alternative, just replace-or-submit-in-full).

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
  no business days in range). Also covers the overlap/replacement addition:
  a same-type overlap trimmed and confirmed; a Medical Leave replacement of
  an already-**approved** Annual Leave request, confirmed and then
  **approved**, checking both balances and the shrunk annual request; the
  same replacement flow but **denied** instead — the regression test for
  "a denied replacement must leave the original request untouched"; choosing
  "trim" instead of "replace" on that same medical/annual overlap, proving
  the Annual Leave request is left completely alone either way; a
  partially-overlapping *cross-type* request also getting the difference
  worked out (not just same-type overlaps); the proactive `/api/leave/preview`
  overlap field itself, checked directly for a fully-covered case; a
  same-type request that wraps an existing booking (extra days both before
  *and* after) splitting into two independent submitted requests while the
  original stays untouched; and the symmetric decide-time case — approving
  a single-day Medical Leave request that carves into the *middle* of an
  approved Annual Leave week, splitting it into two remaining approved
  requests with the excluded day's hours restored to balance.

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
