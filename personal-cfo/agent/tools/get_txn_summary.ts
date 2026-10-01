import { Link, LinkApiError, type Source, type Transaction } from "@stripe/link-sdk";
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  collectPages,
  GRANULARITIES,
  GROUP_BY,
  MEASURES,
  summarizeTransactions,
} from "../lib/txn-summary";

// About 5,000 transactions. Larger ranges report pagination_complete: false.
const MAX_PAGES = 50;

export default defineTool({
  description: [
    "Totals, counts, and averages of the user's Link transactions, computed exactly.",
    "Use it for every total, count, average, or period comparison instead of adding amounts",
    "yourself. Amounts are integers in the currency's smallest unit; use `formatted` to show",
    "them. Currencies are never converted or combined.",
    "outflow is money out and inflow is money in, by sign only: inflow includes refunds and",
    "transfers, and outflow includes transfers and card payments.",
    "With day, week, or month granularity, rows include `change` and `change_percent` from the",
    "previous period for the same group. Report `coverage` limits: incomplete pagination,",
    "sources without records, pending statuses, and uncategorized transactions.",
  ].join(" "),
  inputSchema: z.object({
    start_date: z.iso.date().describe("Inclusive start date, YYYY-MM-DD."),
    end_date: z.iso.date().describe("Inclusive end date, YYYY-MM-DD."),
    source_ids: z
      .array(z.string())
      .optional()
      .describe("Source IDs to include. Defaults to every source the user authorized."),
    granularity: z
      .enum(GRANULARITIES)
      .optional()
      .describe("Period size for rows. Defaults to all, one period for the whole range."),
    measures: z
      .array(z.enum(MEASURES))
      .min(1)
      .optional()
      .describe("Values to compute. Defaults to outflow and inflow."),
    group_by: z
      .array(z.enum(GROUP_BY))
      .optional()
      .describe("Split rows by category, source, or both. Defaults to no grouping."),
    filters: z
      .object({
        category: z
          .array(z.string())
          .optional()
          .describe('Categories to include. Use "uncategorized" for transactions without one.'),
        flow_type: z.enum(["outflow", "inflow"]).optional(),
        status: z
          .array(z.string())
          .optional()
          .describe("Transaction statuses to include, exactly as Link reports them."),
      })
      .optional(),
  }),
  async execute(input) {
    if (input.start_date > input.end_date) {
      throw new Error("start_date must be on or before end_date.");
    }
    const link = new Link({ accessToken: process.env.LINK_ACCESS_TOKEN ?? "" });

    try {
      const transactions = await collectPages<Transaction>(
        (startingAfter) =>
          link.transactions.list({
            start_date: input.start_date,
            end_date: input.end_date,
            ...(input.source_ids && { sources: input.source_ids }),
            limit: 100,
            ...(startingAfter && { starting_after: startingAfter }),
          }),
        (txn) => txn.id,
        MAX_PAGES,
      );
      const sources = await listSources(link);

      const { data, coverage } = summarizeTransactions(transactions.items, {
        start_date: input.start_date,
        end_date: input.end_date,
        granularity: input.granularity ?? "all",
        measures: input.measures ?? ["outflow", "inflow"],
        group_by: input.group_by ?? [],
        filters: input.filters,
      });

      const requested = input.source_ids ?? sources?.map((source) => source.id ?? "") ?? [];
      const withRecords = new Set(transactions.items.map((txn) => txn.source_id));
      return {
        data,
        coverage: {
          ...coverage,
          pagination_complete: transactions.complete,
          authorized_source_count: sources?.length ?? null,
          // No records can mean no activity or no access. Do not report zero spending.
          sources_without_records: requested.filter((id) => id && !withRecords.has(id)),
        },
      };
    } catch (error) {
      if (error instanceof LinkApiError && error.status === 401) {
        throw new Error(
          "Link access token is invalid or expired. Configure a new LINK_ACCESS_TOKEN.",
        );
      }
      if (error instanceof LinkApiError && error.status === 403) {
        throw new Error(
          `Link denied access to these transactions: ${error.message}. Report what could not be read; do not retry.`,
        );
      }
      throw error;
    }
  },
});

// Sources only feed coverage, so a failure here does not fail the summary.
async function listSources(link: Link): Promise<Source[] | null> {
  try {
    const result = await collectPages<Source>(
      (startingAfter) =>
        link.sources.list({ limit: 100, ...(startingAfter && { starting_after: startingAfter }) }),
      (source) => source.id,
      10,
    );
    return result.complete ? result.items : null;
  } catch {
    return null;
  }
}
