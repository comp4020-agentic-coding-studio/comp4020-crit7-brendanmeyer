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

// listCancellableRequests orders newest-first, so after a second request is
// created for the same person, extractRequestId (which matches the first
// occurrence) returns the newest one — used below to grab a just-created
// request's id without adding test-only markup.
function locationParams(location: string | null): URLSearchParams {
  if (!location) throw new Error("redirect carried no location header");
  return new URL(location, baseUrl).searchParams;
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

  it("shows Approved and a decremented balance (140h - 35h = 105.0h)", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Approved");
    expect(html).toContain("105.0");
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
    expect(html).toContain("105.0");
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

  it("shows Cancelled and the balance restored to 140.0h", async () => {
    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Cancelled");
    expect(html).toContain("140.0");
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
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(`/ess/${employeeB}/absences?error=insufficient_balance`)).toBe(true);

    // The rejected form's own values ride back on the redirect's query
    // string, so following it re-renders the page with what the user typed
    // rather than resetting the form.
    const html = await get(location);
    expect(html).toContain("No leave requests yet.");
    expect(html).toContain('value="2026-11-02"');
    expect(html).toContain('value="2026-12-11"');
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
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(`/ess/${employeeC}/absences?error=no_business_days`)).toBe(true);

    const html = await get(`/ess/${employeeC}/absences/`);
    expect(html).toContain("No leave requests yet.");
  });
});

describe("leave preview API", () => {
  it("reports the business days and hours a range covers", async () => {
    const query = new URLSearchParams({
      startDate: "2026-11-02",
      endDate: "2026-11-06",
      hoursFirstDay: "7",
      hoursLastDay: "7",
    });
    const res = await fetch(new URL(`/api/leave/preview?${query}`, baseUrl));
    expect(await res.json()).toEqual({
      ok: true,
      hoursRequested: 35,
      businessDays: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    });
  });

  it("reports an error for a range with no business days", async () => {
    const query = new URLSearchParams({
      startDate: "2026-09-26",
      endDate: "2026-09-27",
      hoursFirstDay: "7",
      hoursLastDay: "7",
    });
    const res = await fetch(new URL(`/api/leave/preview?${query}`, baseUrl));
    expect(await res.json()).toEqual({ ok: false, error: "no_business_days" });
  });
});

describe("overlap: same leave type gets trimmed", () => {
  let firstRequestId: number;
  let secondRequestId: number;

  it("submits the first Annual Leave request (a clean Mon-Fri week)", async () => {
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "1",
        startDate: "2026-11-09",
        endDate: "2026-11-13",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/ess/${employeeB}/absences`);

    firstRequestId = extractRequestId(await get(`/ess/${employeeB}/absences/cancel/`));
  });

  it("submitting a second, overlapping Annual Leave request asks to confirm the trim", async () => {
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "1",
        startDate: "2026-11-12", // overlaps the first request's last 2 days
        endDate: "2026-11-17", // and extends 2 new business days into next week
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(res.status).toBe(303);
    const params = locationParams(res.headers.get("location"));
    expect(params.get("confirm")).toBe("same_type");
    expect(params.get("overlapRequestId")).toBe(String(firstRequestId));
    expect(params.get("adjustedHours")).toBe("14");
    expect(params.get("adjustedStartDate")).toBe("2026-11-16");
    expect(params.get("adjustedEndDate")).toBe("2026-11-17");
  });

  it("confirming the trim creates only the adjusted (smaller) request", async () => {
    const res = await post(
      "/api/leave/submit-confirm",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "1",
        startDate: "2026-11-12",
        endDate: "2026-11-17",
        hoursFirstDay: "7",
        hoursLastDay: "7",
        overlapRequestId: String(firstRequestId),
        action: "trim",
      }),
    );
    expect(res.status).toBe(303);

    const html = await get(`/ess/${employeeB}/absences/`);
    expect(html).toContain("2026-11-16 to 2026-11-17");
    expect(html).toContain("14.0 hours");
    expect(html).toContain(`request #${firstRequestId}`);

    secondRequestId = extractRequestId(await get(`/ess/${employeeB}/absences/cancel/`));
    expect(secondRequestId).not.toBe(firstRequestId);
  });

  it("approving the trimmed request only deducts its own (adjusted) hours", async () => {
    const res = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(secondRequestId), decision: "approve" }),
    );
    expect(res.status).toBe(303);

    const html = await get(`/ess/${employeeB}/absences/`);
    expect(html).toContain("126.0"); // 140h - 14h, not 140h - 35h - 14h
  });
});

describe("overlap: Medical Leave can replace an approved Annual Leave request", () => {
  it("approves an Annual Leave request, then submitting overlapping Medical Leave offers to replace it", async () => {
    const submitRes = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeC),
        leaveTypeId: "1",
        startDate: "2026-11-09",
        endDate: "2026-11-13",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(submitRes.status).toBe(303);
    const annualId = extractRequestId(await get(`/ess/${employeeC}/absences/cancel/`));

    const decideRes = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(annualId), decision: "approve" }),
    );
    expect(decideRes.status).toBe(303);

    const medicalRes = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeC),
        leaveTypeId: "3", // medical
        startDate: "2026-11-11", // overlaps the annual request's last 3 days
        endDate: "2026-11-13",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(medicalRes.status).toBe(303);
    const params = locationParams(medicalRes.headers.get("location"));
    expect(params.get("confirm")).toBe("medical_replace_candidate");
    expect(params.get("overlapRequestId")).toBe(String(annualId));

    const confirmRes = await post(
      "/api/leave/submit-confirm",
      new URLSearchParams({
        personId: String(employeeC),
        leaveTypeId: "3",
        startDate: "2026-11-11",
        endDate: "2026-11-13",
        hoursFirstDay: "7",
        hoursLastDay: "7",
        overlapRequestId: String(annualId),
        action: "replace",
      }),
    );
    expect(confirmRes.status).toBe(303);

    const approvalsHtml = await get(`/mss/${manager}/approvals/`);
    expect(approvalsHtml).toContain("Priya Nair");
    expect(approvalsHtml).toContain(`replaces overlapping Annual Leave request #${annualId}`);

    const medicalId = extractRequestId(await get(`/ess/${employeeC}/absences/cancel/`));

    const approveMedicalRes = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(medicalId), decision: "approve" }),
    );
    expect(approveMedicalRes.status).toBe(303);

    const html = await get(`/ess/${employeeC}/absences/`);
    // Medical: 70h - 21h (3 days) = 49h. Annual: shrinks to a 2-day prefix
    // (14h) and the excluded 21h is restored: 105h (140h - 35h) + 21h = 126h.
    expect(html).toContain("49.0");
    expect(html).toContain("126.0");
    expect(html).toContain("2026-11-09 to 2026-11-10");
    expect(html).toContain(`Medical Leave request #${medicalId}`);
  });
});

describe("overlap: denying the replacement Medical Leave leaves Annual Leave untouched", () => {
  it("a denied replacement request never shrinks or restores the annual request it targeted", async () => {
    const submitRes = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeA),
        leaveTypeId: "1",
        startDate: "2026-12-07",
        endDate: "2026-12-11",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(submitRes.status).toBe(303);
    const annualId = extractRequestId(await get(`/ess/${employeeA}/absences/cancel/`));

    await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(annualId), decision: "approve" }),
    );

    const medicalRes = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeA),
        leaveTypeId: "3",
        startDate: "2026-12-09",
        endDate: "2026-12-11",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    const params = locationParams(medicalRes.headers.get("location"));
    expect(params.get("confirm")).toBe("medical_replace_candidate");

    await post(
      "/api/leave/submit-confirm",
      new URLSearchParams({
        personId: String(employeeA),
        leaveTypeId: "3",
        startDate: "2026-12-09",
        endDate: "2026-12-11",
        hoursFirstDay: "7",
        hoursLastDay: "7",
        overlapRequestId: String(annualId),
        action: "replace",
      }),
    );

    const medicalId = extractRequestId(await get(`/ess/${employeeA}/absences/cancel/`));

    const denyRes = await post(
      "/api/leave/decide",
      new URLSearchParams({ managerId: String(manager), requestId: String(medicalId), decision: "deny" }),
    );
    expect(denyRes.status).toBe(303);

    const html = await get(`/ess/${employeeA}/absences/`);
    expect(html).toContain("Denied");
    expect(html).toContain("2026-12-07 to 2026-12-11"); // annual request's dates: unchanged
    expect(html).toContain("35.0 hours"); // annual request's hours: unchanged
    expect(html).toContain("105.0"); // annual balance (140h - 35h): unchanged, nothing restored
  });
});

describe("overlap: a different, unrelated leave type just asks to confirm", () => {
  it("overlapping Personal/Carer's Leave over an approved Annual Leave request can be submitted as entered", async () => {
    const res = await post(
      "/api/leave/submit",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "2", // Personal/Carer's Leave
        startDate: "2026-11-16", // exactly the trimmed Annual Leave request from an earlier describe block
        endDate: "2026-11-17",
        hoursFirstDay: "7",
        hoursLastDay: "7",
      }),
    );
    expect(res.status).toBe(303);
    const params = locationParams(res.headers.get("location"));
    expect(params.get("confirm")).toBe("other");

    const confirmRes = await post(
      "/api/leave/submit-confirm",
      new URLSearchParams({
        personId: String(employeeB),
        leaveTypeId: "2",
        startDate: "2026-11-16",
        endDate: "2026-11-17",
        hoursFirstDay: "7",
        hoursLastDay: "7",
        overlapRequestId: params.get("overlapRequestId") ?? "",
        action: "as_entered",
      }),
    );
    expect(confirmRes.status).toBe(303);

    const html = await get(`/ess/${employeeB}/absences/`);
    expect(html).toContain("Personal/Carer"); // rendered as Personal/Carer&#39;s Leave
    expect(html).toContain("14.0 hours");
  });
});
