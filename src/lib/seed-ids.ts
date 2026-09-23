// Known IDs for the data src/lib/db.ts seeds on first boot against an empty
// database. Zero side effects on purpose (no better-sqlite3 import) — spec
// files import these directly instead of importing them from db.ts, whose
// module load runs migrate() + seeding against whatever DATABASE_PATH
// resolves to in *that* process. spec/routes.ts is read by the vitest
// process itself, not the spawned server child that owns the throwaway test
// DB, so importing db.ts there would seed the wrong file.

export const SEED_PEOPLE = {
  manager: 1,
  employeeA: 2,
  employeeB: 3,
  employeeC: 4,
} as const;

export const SEED_LEAVE_TYPES = {
  annual: 1,
  carer: 2,
  medical: 3,
  lwop: 4,
} as const;

export const SEED_BALANCE_HOURS = {
  annual: 140, // 20 days
  carer: 70, // 10 days
  medical: 70, // 10 days
} as const;
