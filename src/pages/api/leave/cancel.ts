import type { APIRoute } from "astro";
import { cancelLeaveRequest } from "../../../lib/db";

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const personId = Number(form.get("personId"));
  const requestId = String(form.get("requestId") ?? "");
  const cancellationReason = String(form.get("cancellationReason") ?? "");
  const back = `/ess/${personId}/absences/cancel`;

  const result = cancelLeaveRequest({
    requestId: Number(requestId),
    personId,
    cancellationReason,
  });

  if (!result.ok) {
    const params = new URLSearchParams({ error: result.error, requestId, cancellationReason });
    return redirect(`${back}?${params}`, 303);
  }
  return redirect(back, 303);
};
