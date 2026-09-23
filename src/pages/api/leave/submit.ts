import type { APIRoute } from "astro";
import { planLeaveSubmission, submitLeaveRequest } from "../../../lib/db";

// Plain HTML form POST -> redirect -> the submitting tab re-renders from
// SQLite. Errors travel back as ?error=<code> rather than a response body,
// since there's no client-side JS reading a response; on failure the
// submitted field values ride along on the same query string so the page
// can re-render the form as the user left it instead of resetting it.
//
// planLeaveSubmission checks the new request against the employee's own
// existing active requests BEFORE anything is written. A clean submission
// (or an invalid one) behaves exactly as before; an overlap redirects back
// with ?confirm=<kind>&overlapRequestId=<id> instead of writing anything —
// the employee has to explicitly confirm what happens next (see
// submit-confirm.ts). The redirect deliberately doesn't carry the computed
// segments/adjusted-hours themselves (an overlap can now split into any
// number of them) — the apply page re-runs planLeaveSubmission itself from
// the echoed original fields to render whatever is currently true, the same
// way submit-confirm.ts does before writing. The apply page also calls
// /api/leave/preview live (see preview.ts) so most of this is already
// visible to the employee before they ever click Submit — this route is the
// same check run again as the authoritative, JS-independent gate at write time.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const personId = Number(form.get("personId"));
  const back = `/ess/${personId}/absences`;

  const leaveTypeId = String(form.get("leaveTypeId") ?? "");
  const startDate = String(form.get("startDate") ?? "");
  const endDate = String(form.get("endDate") ?? "");
  const hoursFirstDay = String(form.get("hoursFirstDay") ?? "");
  const hoursLastDay = String(form.get("hoursLastDay") ?? "");
  const reason = String(form.get("reason") ?? "");
  const echo = { leaveTypeId, startDate, endDate, hoursFirstDay, hoursLastDay, reason };

  const plan = planLeaveSubmission({
    personId,
    leaveTypeId: Number(leaveTypeId),
    startDate,
    endDate,
    hoursFirstDay: Number(hoursFirstDay),
    hoursLastDay: Number(hoursLastDay),
  });

  if (plan.kind === "invalid") {
    return redirect(`${back}?${new URLSearchParams({ error: plan.error, ...echo })}`, 303);
  }

  // Nothing new to offer: every business day is already booked. This is a
  // plain error, not something to confirm.
  if (plan.kind === "fully_covered") {
    return redirect(`${back}?${new URLSearchParams({ error: "fully_covered_by_existing", ...echo })}`, 303);
  }

  if (plan.kind !== "none") {
    const params = new URLSearchParams({
      confirm: plan.kind,
      overlapRequestId: String(plan.overlapRequestId),
      ...echo,
    });
    return redirect(`${back}?${params}`, 303);
  }

  const result = submitLeaveRequest({
    personId,
    leaveTypeId: Number(leaveTypeId),
    startDate,
    endDate,
    hoursFirstDay: Number(hoursFirstDay),
    hoursLastDay: Number(hoursLastDay),
    reason,
  });

  if (!result.ok) {
    return redirect(`${back}?${new URLSearchParams({ error: result.error, ...echo })}`, 303);
  }
  return redirect(back, 303);
};
