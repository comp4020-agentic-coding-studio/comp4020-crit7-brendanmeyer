// Mutating routes redirect back to the originating page with ?error=<code>;
// pages map the code to a message here rather than duplicating the copy.
export const ERROR_MESSAGES: Record<string, string> = {
  insufficient_balance: "You don't have enough balance for that leave type to cover this request.",
  no_business_days: "That date range doesn't include any business days (Monday–Friday).",
  invalid_hours: "Hours for the first and last day must be greater than 0 and no more than 7.",
  invalid_range: "The end date can't be before the start date.",
  invalid_input: "That leave type doesn't exist.",
  reason_required: "A reason is required to cancel an absence.",
  not_cancellable: "That request can no longer be cancelled.",
  not_authorized: "You're not the manager for that request.",
  not_pending: "That request has already been decided.",
  fully_covered_by_existing:
    "Every business day in this request is already covered by an existing request of the same leave type. Adjust the dates, or cancel that request first.",
  overlap_changed: "The overlapping request changed before you confirmed — please review and submit again.",
};

export function errorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please try again.";
}
