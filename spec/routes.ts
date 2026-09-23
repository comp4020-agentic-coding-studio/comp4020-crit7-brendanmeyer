// The routes the invariants run against. When you add a page, add its route
// here, or the invariants stop covering it.
import { SEED_PEOPLE } from "../src/lib/seed-ids";

const { manager, employeeA } = SEED_PEOPLE;

export const ROUTES = [
  "/",
  "/readme/",
  `/ess/${employeeA}/`,
  `/ess/${employeeA}/absences/`,
  `/ess/${employeeA}/absences/cancel/`,
  `/mss/${manager}/`,
  `/mss/${manager}/approvals/`,
  `/mss/${manager}/team/`,
  `/mss/${manager}/team/${employeeA}/`,
];
