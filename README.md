# HORUS-lite: a leave-management prototype

A lightweight clone of ANU's real HORUS leave-management workflow (the
PeopleSoft HCM Absence Management skin every staff member and manager
actually deals with), covering the full loop: an employee applies for
leave, a manager approves or denies it, the employee can cancel before or
after approval (with different rules for each), the manager actions that
cancellation, and the manager can pull up an employee's full absence
history. Leave balances are real, not decorative — they decrement on
approval and restore on an approved cancellation — and a new request that
overlaps leave the employee already has booked gets detected and worked out
in hours, not just accepted or rejected outright.

## What good looks like here

Good means the state machine actually holds: a status can't drift into an
invalid transition, a balance can't be double-spent, and an overlap can't
quietly corrupt an existing booking. Some of that is enforced mechanically,
some of it was a judgement call.

**Enforced by the repo, not just asserted in this file:**

- Every leave-status write goes through one of four named helpers in
  `db.ts` — nothing else is allowed to set a request's status directly, so
  the status enum can't drift out from under the state machine.
- Business-day and hours arithmetic lives in one pure, unit-tested module
  (`src/lib/leave-hours.ts`); no page or route is allowed to duplicate that
  math inline.
- Every page renders through the same base layout, so the accessibility
  floor — one `<h1>`, a nav landmark, alt text, zero axe violations — can't
  drift as pages get added, and every route is registered in `spec/routes.ts`
  so a new page can't go silently ungraded.
- A request that *replaces* another (Medical Leave overlapping approved
  Annual Leave) only ever mutates the original at the manager's
  approve step, never at employee-confirm time — a denied replacement
  can't cost an employee balance they still hold.

**Judgement calls:**

- Which slice of HORUS to model. Real HORUS covers a lot more than leave
  (timesheets, delegations, position management); this clone picks the one
  loop that's actually visible to most staff and builds that end to end
  rather than a thin layer across everything.
- How far to generalise overlap detection. It started as same-type-only
  trimming and grew, through direct feedback, into tracking hours used per
  day and splitting a request across however many segments the remainder
  actually needs — see `PROCESS.md` for how that happened.
- Functional fidelity over visual fidelity: this doesn't try to look like
  HORUS, it tries to behave like it.

**Deliberate scope cuts**, so a marker who knows the real ANU system reads
these as decisions, not bugs:

- No real auth. The landing page is a tile per seeded person, labelled
  Employee or Manager; identity travels in the URL path, no passwords.
- A flat org: one manager, every seeded employee reports to them. The
  manager doesn't submit their own leave in this slice.
- Weekend-only business-day counting, with no public-holiday calendar.
- Partial days are hours, not a half-day boolean, but only the first and
  last day of a request can be partial — every day strictly between them
  is a full 7-hour day.
- Attachments are mocked in the UI (a disabled file input) — no real
  upload or storage, since Fly's filesystem is ephemeral.
- No email notifications — the manager's in-app pending-approvals list is
  the substitute.
- A single-decision audit trail: the current decision on a request is
  recorded, not a full log of every state it passed through.

`CLAUDE.md` holds the rules that keep the above true and the checks that
enforce them; `docs/plan-leave-management.md` is the design record they
came from; `PROCESS.md` is how the build actually went.
