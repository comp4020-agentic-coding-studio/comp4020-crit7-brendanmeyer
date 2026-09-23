import { describe, expect, inject, it } from "vitest";
import { SEED_PEOPLE } from "../src/lib/seed-ids";

// Drives the running app over HTTP to prove the leave state machine holds
// end to end: submit -> approve -> cancel -> action the cancellation, with
// balance decrementing/restoring at the right transitions and history
// retaining every status. IDs come from src/lib/seed-ids.ts, never db.ts —
// see that file's header comment for why.
const baseUrl = inject("baseUrl");
const { manager, employeeA, employeeB, employeeC } = SEED_PEOPLE;

// Astro checks form POSTs carry a same-origin Origin header; a bare fetch
// doesn't send one automatically.
const post = (path: string, body: URLSearchParams) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body,
    redirect: "manual",
  });

const get = async (path: string) => (await fetch(new URL(path, baseUrl))).text();

function extractRequestId(cancelPageHtml: string): number {
  const match = cancelPageHtml.match(/name="requestId" value="(\d+)"/);
  if (!match) throw new Error("no cancellable request found on the cancel page");
  return Number(match[1]);
}

describe("leave request lifecycle", () => {
  let requestId: number;

  it("submits a 5-business-day Annual Leave request", async () => {
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeA),
        leaveTypeId: "1", // annual
        startDate: "2026-11-02", // Monday
        endDate: "2026-11-06", // Friday
        hoursFirstDay: "7",
        hoursLastDay: "7",
        reason: "Spec probe leave",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/ess/${employeeA}/absences`);
  });

  it("shows the new request as Submitted", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Annual Leave");
    expect(html).toContain("Submitted");
  });

  it("finds the request's id via the cancel page's hidden input", async () => {
    const html = await get(`/ess/${employeeA}/absences/cancel/`);
    requestId = extractRequestId(html);
    expect(requestId).toBeGreaterThan(0);
  });

  it("shows up in the manager's approvals list labelled as a Leave Request", async () => {
    const html = await get(`/mss/${manager}/approvals/`);
    expect(html).toContain("Leave Request");
    expect(html).toContain("Sam Chen");
  });

  it("manager approves the request", async () => {
    const res = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(requestId), decision: "approve" }),
    );
    expect(res.status).toBe(303);
  });

  it("shows Approved and a decremented balance (140h - 35h = 15.0 days)", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Approved");
    expect(html).toContain("15.0");
  });

  it("employee cancels the approved leave", async () => {
    const res = await post(
      "/api/leave/cancel",
      new URLSearchParams({
        personId: String(employeeA),
        requestId: String(requestId),
        cancellationReason: "Plans changed",
      }),
    );
    expect(res.status).toBe(303);
  });

  it("shows Cancel in Progress with the balance still down", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Cancel in Progress");
    expect(html).toContain("15.0");
  });

  it("the same request now shows in approvals as a Cancel Absence", async () => {
    const html = await get(`/mss/${manager}/approvals/`);
    expect(html).toContain("Cancel Absence");
  });

  it("manager approves the cancellation", async () => {
    const res = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(requestId), decision: "approve" }),
    );
    expect(res.status).toBe(303);
  });

  it("shows Cancelled and the balance restored to 20.0 days", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Cancelled");
    expect(html).toContain("20.0");
  });

  it("the manager's view of the employee's history still retains the cancelled request", async () => {
    const html = await get(`/mss/${manager}/team/${employeeA}/`);
    expect(html).toContain("Annual Leave");
    expect(html).toContain("Cancelled");
  });
});

describe("leave request validation", () => {
  it("rejects a request for more hours than the balance covers", async () => {
    // employeeB's annual balance is 140h; six business weeks at 7h/day is
    // well beyond it.
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "1",
        startDate: "2026-11-02",
        endDate: "2026-12-11",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/ess/${employeeB}/absences?error=insufficient_balance`);

    const html = await get(`/ess/${employeeB}/absences/`);
    expect(html).toContain("No leave requests yet.");
  });

  it("rejects a date range with zero business days", async () => {
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeC),
        leaveTypeId: "1",
        startDate: "2026-09-26", // Saturday
        endDate: "2026-09-27", // Sunday
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/ess/${employeeC}/absences?error=no_business_days`);

    const html = await get(`/ess/${employeeC}/absences/`);
    expect(html).toContain("No leave requests yet.");
  });
});
