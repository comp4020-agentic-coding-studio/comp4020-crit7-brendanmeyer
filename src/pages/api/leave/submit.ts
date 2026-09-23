import type { APIRoute } from "astro";
import { submitLeaveRequest } from "../../../lib/db";

// Plain HTML form POST -> redirect -> the submitting tab re-renders from
// SQLite. Errors travel back as ?error=<code> rather than a response body,
// since there's no client-side JS reading a response; on failure the
// submitted field values ride along on the same query string so the page
// can re-render the form as the user left it instead of resetting it.
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
    const params = new URLSearchParams({
      error: result.error,
      leaveTypeId,
      startDate,
      endDate,
      hoursFirstDay,
      hoursLastDay,
      reason,
    });
    return redirect(`${back}?${params}`, 303);
  }
  return redirect(back, 303);
};
