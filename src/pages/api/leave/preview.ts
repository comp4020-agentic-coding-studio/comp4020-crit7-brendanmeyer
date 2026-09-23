import type { APIRoute } from "astro";
import { planLeaveSubmission } from "../../../lib/db";
import { computeHoursRequested } from "../../../lib/leave-hours";

// Backs the apply-leave form's live readout: the hours a request will count
// (unchanged), plus — proactively, as the employee is still filling the
// form in, before they ever click Submit — whatever planLeaveSubmission
// would do about an overlap with their own existing leave. The actual
// submit still re-runs planLeaveSubmission itself as the authoritative,
// JS-independent gate; this is purely an earlier heads-up.
export const GET: APIRoute = async ({ url }) => {
  const startDate = url.searchParams.get("startDate") ?? "";
  const endDate = url.searchParams.get("endDate") ?? "";
  const hoursFirstDay = Number(url.searchParams.get("hoursFirstDay"));
  const hoursLastDay = Number(url.searchParams.get("hoursLastDay"));
  const personIdParam = url.searchParams.get("personId");
  const leaveTypeIdParam = url.searchParams.get("leaveTypeId");

  if (!startDate || !endDate) {
    return Response.json({ ok: false, error: "invalid_range" });
  }

  const computed = computeHoursRequested(startDate, endDate, hoursFirstDay, hoursLastDay);
  if (!computed.ok) return Response.json(computed);

  let overlap: Record<string, unknown> | null = null;
  if (personIdParam && leaveTypeIdParam) {
    const personId = Number(personIdParam);
    const leaveTypeId = Number(leaveTypeIdParam);
    const plan = planLeaveSubmission({ personId, leaveTypeId, startDate, endDate, hoursFirstDay, hoursLastDay });
    if (plan.kind === "invalid") {
      overlap = { kind: "invalid", error: plan.error };
    } else if (plan.kind === "fully_covered") {
      overlap = { kind: "fully_covered" };
    } else if (plan.kind === "unresolvable") {
      overlap = { kind: "unresolvable" };
    } else if (plan.kind === "overlap" || plan.kind === "medical_replace_candidate") {
      overlap = {
        kind: plan.kind,
        adjustedHours: plan.trimmed?.hoursRequested,
        adjustedStartDate: plan.trimmed?.startDate,
        adjustedEndDate: plan.trimmed?.endDate,
      };
    }
    // plan.kind === "none": overlap stays null.
  }

  return Response.json({ ...computed, overlap });
};
