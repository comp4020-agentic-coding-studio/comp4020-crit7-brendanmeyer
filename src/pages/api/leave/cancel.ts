import type { APIRoute } from "astro";
import { cancelLeaveRequest } from "../../../lib/db";

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const personId = Number(form.get("personId"));
  const back = `/ess/${personId}/absences/cancel`;

  const result = cancelLeaveRequest({
    requestId: Number(form.get("requestId")),
    personId,
    cancellationReason: String(form.get("cancellationReason") ?? ""),
  });

  if (!result.ok) {
    return redirect(`${back}?error=${result.error}`, 303);
  }
  return redirect(back, 303);
};
