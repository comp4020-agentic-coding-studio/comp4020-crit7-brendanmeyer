# TODO — crit 7: Build the ANU system you wish existed

- [x] Pick the real ANU system slice to model — HORUS-lite: a PeopleSoft-style
      leave/absence-management prototype (submit → approve/deny → cancel →
      action the cancellation → manager views history), with real balance
      tracking. Scope and non-negotiables are recorded in `CLAUDE.md`.
- [ ] Deploy the untouched starter first: `flyctl deploy --remote-only --ha=false -a comp4020-crit7-brendanmeyer`
      — proves the deploy path works before any real work rides on it
- [x] Build the chosen flow end to end (schema → `db.ts` → API → UI): landing
      tile picker, ESS absences/cancel pages, MSS approvals/team/history
      pages, `/api/leave/{submit,cancel,decide}`.
- [x] Write `spec/*.test.ts` coverage for the core flow: `spec/leave-hours.test.ts`
      (pure business-day/hours unit tests) and `spec/leave.test.ts` (full
      HTTP-driven state-machine walk: submit → approve → cancel → action the
      cancellation → history retains it, plus two negative-path cases).
- [ ] Replace `README.md` with the real account of what the app is and what
      good looks like here — note the deliberate scope cuts (no real auth,
      weekend-only business-day counting with no public-holiday calendar,
      single-decision audit trail, mocked attachments)
- [ ] Replace `PROCESS.md` with the real process write-up, cited to commits
- [ ] Write `reflections/crit-7.md`
- [ ] Keep `pnpm check` and `pnpm check:evidence` green throughout
- [ ] Confirm the app is live at `comp4020-crit7-brendanmeyer.fly.dev` by the
      cutoff (2026-09-28 13:30)
