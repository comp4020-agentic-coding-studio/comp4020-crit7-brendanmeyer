import type { APIRoute } from "astro";
import { planLeaveSubmission, submitLeaveRequest, submitLeaveRequestSegments } from "../../../lib/db";

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

  if (plan.kind === "none") {
    // The overlap resolved itself since the plan was made — just submit as entered.
    const result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
    });
    if (!result.ok) return fail(result.error);
    return redirect(back, 303);
  }

  if (action === "trim" && (plan.kind === "overlap" || plan.kind === "medical_replace_candidate") && plan.segments) {
    // One row when the difference is a single contiguous run (the common
    // case), several when applying for extra days both before and after
    // something already booked means it has to split into more than one.
    const result = submitLeaveRequestSegments({
      personId,
      leaveTypeId: Number(leaveTypeId),
      reason,
      segments: plan.segments,
      overlapRequestId: plan.overlapRequestId,
    });
    if (!result.ok) return fail(result.error);
    return redirect(back, 303);
  }

  if (action === "replace" && plan.kind === "medical_replace_candidate") {
    const result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
      replacesRequestId: plan.overlapRequestId,
      systemNote:
        `If approved, replaces overlapping Annual Leave request #${plan.overlapRequestId} — ` +
        `those days will be excluded from it and its balance restored.`,
    });
    if (!result.ok) return fail(result.error);
    return redirect(back, 303);
  }

  if (action === "as_entered" && (plan.kind === "medical_replace_candidate" || plan.kind === "overlap")) {
    const result = submitLeaveRequest({
      personId,
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      hoursFirstDay: Number(hoursFirstDay),
      hoursLastDay: Number(hoursLastDay),
      reason,
    });
    if (!result.ok) return fail(result.error);
    return redirect(back, 303);
  }

  // The action doesn't match what's actually true right now (state moved,
  // or a stale/tampered form field).
  return fail("overlap_changed");
};
