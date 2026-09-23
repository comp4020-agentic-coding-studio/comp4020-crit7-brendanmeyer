# Working on this repo

## Design

`docs/plan-leave-management.md` is the actual design record for this stage
(data model, business rules, route table, `db.ts` helper contracts, testing
strategy) — it's what got built, kept in the repo instead of only in a local
planning session, so the reasoning behind the code survives past the chat
that produced it. Read it before touching the leave feature; update it in
the same change if a design decision it documents changes.

## Non-negotiables

- `pnpm check` (typecheck + build + vitest) must be green before any commit
  that isn't explicitly a WIP checkpoint. `pnpm check:evidence` must also pass
  before considering a milestone done.
- Every new page/route gets added to `spec/routes.ts` in the same change that
  adds it — a route the invariants suite never sees is a route that's
  silently ungraded.
- Seed identity (`SEED_PEOPLE`, `SEED_LEAVE_TYPES`, `SEED_BALANCE_HOURS`)
  lives only in `src/lib/seed-ids.ts`, a side-effect-free module with no
  `better-sqlite3` import. Any spec file that needs a known ID imports it
  from there — never from `db.ts` — because `db.ts` runs `migrate()`/seeding
  at import time and `spec/routes.ts` is imported directly by the vitest
  process, not through the spawned server child that owns the throwaway test
  database.
- All leave-status writes go through the named `db.ts` helpers
  (`submitLeaveRequest`, `cancelLeaveRequest`, `decideLeaveRequest`) — no
  other code path sets `leaveRequests.status` directly. This is how the enum
  stays honest without a SQL CHECK constraint.
- Business-day and hours math lives only in `src/lib/leave-hours.ts` (pure,
  unit-tested). Don't duplicate the arithmetic inline in an API route or
  page.
- Every page renders through `src/layouts/Base.astro` (owns `lang`,
  viewport, title, the `<nav>` landmark) so the structural/accessibility
  floor `spec/invariants.test.ts` checks — one `<h1>`, a nav landmark, alt
  text, zero axe violations — can't drift as pages are added.

## Process

- Commit as the work grows (schema → seed → one page/route at a time), not
  as one giant end-of-week commit — the brief grades commit history as
  evidence of process, not just the final diff.
- Before marking a step done, re-run `pnpm check`; don't chain several
  features on top of a red suite.
- Flag deliberate scope cuts in `README.md` as they're made (e.g.
  weekend-only business-day counting with no public-holiday calendar,
  single-decision audit trail, mocked attachments, no real auth) — a marker
  who knows the real ANU system should read these as decisions, not bugs.

## Deployment

- Fly app: `comp4020-crit7-brendanmeyer`. Deploy with
  `flyctl deploy --remote-only --ha=false -a comp4020-crit7-brendanmeyer` via
  `mise exec --` (the Fly token lives in the repo's own `mise.local.toml`,
  gitignored).
- Confirm the deployed app still boots against an *empty* volume after any
  schema change — the seeding path is the only thing that populates a fresh
  database, staging and prod included.

## Stage boundary

This file currently reflects stage one of the assignment (the HORUS-lite
leave-management feature itself). `PROCESS.md`, the full `README.md` rewrite
and `reflections/crit-7.md` are tracked in `TODO.md` and belong to a later
planning pass, once there's a finished feature to write about — don't start
that work without planning it first.
