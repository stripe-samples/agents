import { defineTool } from "eve/tools";
import { z } from "zod";

// The refund policy: refunds inside the window are within policy.
// Older refunds are exceptions for a person to decide.
const REFUND_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default defineTool({
  description:
    "Check whether a charge is within the 30-day refund window. Call this after " +
    "reading the charge from Stripe and before proposing a refund. Pass the charge's " +
    "real `created` timestamp — do not estimate it.",
  inputSchema: z.object({
    chargeCreatedUnixSeconds: z
      .number()
      .int()
      .positive()
      .describe("The charge's `created` timestamp, in Unix seconds."),
  }),
  async execute({ chargeCreatedUnixSeconds }) {
    const ageDays = Math.floor((Date.now() - chargeCreatedUnixSeconds * 1000) / DAY_MS);
    const withinPolicy = ageDays <= REFUND_WINDOW_DAYS;

    return {
      withinPolicy,
      reason: withinPolicy
        ? `Charge is within the ${REFUND_WINDOW_DAYS}-day refund window.`
        : `Charge is ${ageDays} days old, past the ${REFUND_WINDOW_DAYS}-day refund window.`,
      chargeAgeDays: ageDays,
      refundWindowDays: REFUND_WINDOW_DAYS,
    };
  },
});
