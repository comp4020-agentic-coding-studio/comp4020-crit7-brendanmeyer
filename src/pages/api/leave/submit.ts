import type { APIRoute } from "astro";
import { submitLeaveRequest } from "../../../lib/db";

// Plain HTML form POST -> redirect -> the submitting tab re-renders from
// SQLite. Errors travel back as ?error=<code> rather than a response body,
// since there's no client-side JS to read one.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const personId = Number(form.get("personId"));
  const back = `/ess/${personId}/absences`;

  const result = submitLeaveRequest({
    personId,
    leaveTypeId: Number(form.get("leaveTypeId")),
    startDate: String(form.get("startDate") ?? ""),
    endDate: String(form.get("endDate") ?? ""),
    hoursFirstDay: Number(form.get("hoursFirstDay")),
    hoursLastDay: Number(form.get("hoursLastDay")),
    reason: String(form.get("reason") ?? ""),
  });

  if (!result.ok) {
    return redirect(`${back}?error=${result.error}`, 303);
  }
  return redirect(back, 303);
};
