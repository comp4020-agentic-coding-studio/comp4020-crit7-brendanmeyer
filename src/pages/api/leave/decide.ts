import type { APIRoute } from "astro";
import { decideLeaveRequest } from "../../../lib/db";

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const managerId = Number(form.get("managerId"));
  const back = `/mss/${managerId}/approvals`;

  const decision = String(form.get("decision") ?? "");
  if (decision !== "approve" && decision !== "deny") {
    return redirect(`${back}?error=invalid_input`, 303);
  }

  const result = decideLeaveRequest({
    requestId: Number(form.get("requestId")),
    managerId,
    decision,
  });

  if (!result.ok) {
    return redirect(`${back}?error=${result.error}`, 303);
  }
  return redirect(back, 303);
};
