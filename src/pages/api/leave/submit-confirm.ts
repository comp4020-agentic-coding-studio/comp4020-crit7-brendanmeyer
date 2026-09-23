import type { APIRoute } from "astro";
import { type LeaveRequest, type Result, getRequestById, planLeaveSubmission, submitLeaveRequest } from "../../../lib/db";

// Finalizes a submission the employee confirmed on the absences page after
// planLeaveSubmission flagged an overlap (see submit.ts). Re-plans fresh
// rather than trusting anything rendered earlier — state may have changed
// (e.g. the overlapping request was cancelled) since the banner was shown.
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
  const action = String(form.get("action") ?? "");
  const echo = { leaveTypeId, startDate, endDate, hoursFirstDay, hoursLastDay, reason };

  const fail = (error: string) => redirect(`${back}?${new URLSearchParams({ error, ...echo })}`, 303);

  const plan = planLeaveSubmission({
    personId,
    leaveTypeId: Number(leaveTypeId),
    startDate,
    endDate,
    hoursFirstDay: Number(hoursFirstDay),
    hoursLastDay: Number(hoursLastDay),
  });

  if (plan.kind === "invalid") return fail(plan.error);
  if (plan.kind === "fully_covered") return fail("fully_covered_by_existing");

  let result: Result<LeaveRequest>;

  if (plan.kind === "none") {
    // The overlap resolved itself since the plan was made — just submit as entered.
    result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
    });
  } else if (action === "trim" && (plan.kind === "overlap" || plan.kind === "medical_replace_candidate") && plan.trimmed) {
    const overlap = getRequestById(plan.overlapRequestId);
    const trimmed = plan.trimmed;
    result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate: trimmed.startDate,
      endDate: trimmed.endDate,
      hoursFirstDay: trimmed.hoursFirstDay,
      hoursLastDay: trimmed.hoursLastDay,
      reason,
      systemNote:
        `Adjusted to ${trimmed.hoursRequested}h (${trimmed.startDate} to ${trimmed.endDate}) — excludes days ` +
        `already covered by ${overlap?.leaveType.name ?? "an existing request"} request #${plan.overlapRequestId}.`,
    });
  } else if (action === "replace" && plan.kind === "medical_replace_candidate") {
    const overlap = getRequestById(plan.overlapRequestId);
    result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
      replacesRequestId: plan.overlapRequestId,
      systemNote:
        `If approved, replaces overlapping Annual Leave request #${plan.overlapRequestId} ` +
        `(${overlap?.startDate} to ${overlap?.endDate}) — those days will be excluded and its balance restored.`,
    });
  } else if (
    action === "as_entered" &&
    (plan.kind === "medical_replace_candidate" || plan.kind === "overlap" || plan.kind === "unresolvable")
  ) {
    result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
    });
  } else {
    // The action doesn't match what's actually true right now.
    return fail("overlap_changed");
  }

  if (!result.ok) return fail(result.error);
  return redirect(back, 303);
};
