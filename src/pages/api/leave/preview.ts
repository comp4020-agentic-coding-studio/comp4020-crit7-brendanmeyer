import type { APIRoute } from "astro";
import { computeHoursRequested, hoursToDays } from "../../../lib/leave-hours";

// Backs the apply-leave form's live "this counts N hours towards your
// balance" readout. All the business-day/hours arithmetic still lives in
// leave-hours.ts — this just wraps it as JSON so the page's script can show
// the result without duplicating that math client-side.
export const GET: APIRoute = async ({ url }) => {
  const startDate = url.searchParams.get("startDate") ?? "";
  const endDate = url.searchParams.get("endDate") ?? "";
  const hoursFirstDay = Number(url.searchParams.get("hoursFirstDay"));
  const hoursLastDay = Number(url.searchParams.get("hoursLastDay"));

  if (!startDate || !endDate) {
    return Response.json({ ok: false, error: "invalid_range" });
  }

  const result = computeHoursRequested(startDate, endDate, hoursFirstDay, hoursLastDay);
  if (!result.ok) {
    return Response.json(result);
  }
  return Response.json({ ...result, days: hoursToDays(result.hoursRequested) });
};
