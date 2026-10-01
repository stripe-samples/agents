import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectPages,
  formatAmount,
  periodsIn,
  type SummaryOptions,
  type SummaryTransaction,
  summarizeTransactions,
} from "../agent/lib/txn-summary.ts";

let nextId = 0;
function txn(overrides: Partial<SummaryTransaction>): SummaryTransaction {
  nextId += 1;
  return {
    id: `txn_${nextId}`,
    source_id: "src_card",
    amount: -1000,
    currency: "usd",
    created_date: "2026-08-15",
    category: "groceries",
    status: "succeeded",
    ...overrides,
  };
}

const august: SummaryOptions = {
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  granularity: "all",
  measures: ["outflow", "inflow", "net_cash_flow", "transaction_count"],
  group_by: [],
};

describe("summarizeTransactions", () => {
  it("totals outflow, inflow, net, and count in minor units", () => {
    const { data, coverage } = summarizeTransactions(
      [txn({ amount: -1250 }), txn({ amount: -749 }), txn({ amount: 500 })],
      august,
    );
    deepStrictEqual(
      data.map((row) => [row.measure, row.value, row.formatted]),
      [
        ["outflow", 1999, "$19.99"],
        ["inflow", 500, "$5.00"],
        ["net_cash_flow", -1499, "-$14.99"],
        ["transaction_count", 3, undefined],
      ],
    );
    strictEqual(coverage.record_count, 3);
    strictEqual(coverage.period_count, 1);
  });

  it("keeps currencies separate and formats by each currency's minor unit", () => {
    const { data, coverage } = summarizeTransactions(
      [txn({ amount: -1000 }), txn({ amount: -1200, currency: "JPY" })],
      { ...august, measures: ["outflow"] },
    );
    deepStrictEqual(
      data.map((row) => [row.currency, row.value, row.formatted]),
      [
        ["jpy", 1200, "¥1,200"],
        ["usd", 1000, "$10.00"],
      ],
    );
    deepStrictEqual(coverage.currencies, ["jpy", "usd"]);
  });

  it("groups by category and source, naming missing values", () => {
    const { data, coverage } = summarizeTransactions(
      [
        txn({ amount: -300 }),
        txn({ amount: -200 }),
        txn({ amount: -100, category: null, source_id: null }),
      ],
      { ...august, measures: ["outflow"], group_by: ["category", "source"] },
    );
    deepStrictEqual(
      data.map((row) => [row.group, row.value]),
      [
        [{ category: "groceries", source_id: "src_card" }, 500],
        [{ category: "uncategorized", source_id: "unknown" }, 100],
      ],
    );
    strictEqual(coverage.uncategorized_count, 1);
    strictEqual(coverage.unknown_source_count, 1);
    deepStrictEqual(coverage.included_source_ids, ["src_card"]);
  });

  it("buckets by month, clips periods to the range, and reports changes", () => {
    const options: SummaryOptions = {
      start_date: "2026-07-10",
      end_date: "2026-09-05",
      granularity: "month",
      measures: ["outflow"],
      group_by: [],
    };
    const { data, coverage } = summarizeTransactions(
      [
        txn({ amount: -2000, created_date: "2026-07-20" }),
        txn({ amount: -3000, created_date: "2026-08-02" }),
        txn({ amount: -1000, created_date: "2026-09-01" }),
      ],
      options,
    );
    deepStrictEqual(
      data.map((row) => [
        row.period_start,
        row.period_end,
        row.value,
        row.change,
        row.change_percent,
      ]),
      [
        ["2026-07-10", "2026-07-31", 2000, undefined, undefined],
        ["2026-08-01", "2026-08-31", 3000, 1000, 50],
        ["2026-09-01", "2026-09-05", 1000, -2000, -66.7],
      ],
    );
    strictEqual(coverage.period_count, 3);
    strictEqual(coverage.non_empty_period_count, 3);
  });

  it("omits change when the previous period has no matching row", () => {
    const { data } = summarizeTransactions(
      [
        txn({ amount: -2000, created_date: "2026-07-20", category: "dining" }),
        txn({ amount: -3000, created_date: "2026-08-02" }),
      ],
      {
        start_date: "2026-07-01",
        end_date: "2026-08-31",
        granularity: "month",
        measures: ["outflow"],
        group_by: ["category"],
      },
    );
    strictEqual(data[1].group?.category, "groceries");
    strictEqual(data[1].change, undefined);
  });

  it("starts weeks on Monday", () => {
    deepStrictEqual(
      periodsIn({
        ...august,
        start_date: "2026-08-01",
        end_date: "2026-08-12",
        granularity: "week",
      }),
      [
        { start: "2026-08-01", end: "2026-08-02" },
        { start: "2026-08-03", end: "2026-08-09" },
        { start: "2026-08-10", end: "2026-08-12" },
      ],
    );
  });

  it("applies filters and counts statuses as Link reports them", () => {
    const { data, coverage } = summarizeTransactions(
      [
        txn({ amount: -1000 }),
        txn({ amount: -500, status: "pending" }),
        txn({ amount: 700 }),
        txn({ amount: -400, category: "dining" }),
      ],
      {
        ...august,
        measures: ["outflow"],
        filters: { flow_type: "outflow", category: ["groceries"] },
      },
    );
    strictEqual(data[0].value, 1500);
    deepStrictEqual(coverage.status_counts, { succeeded: 1, pending: 1 });
  });

  it("drops transactions outside the range", () => {
    const { coverage } = summarizeTransactions(
      [txn({ created_date: "2026-07-31" }), txn({ created_date: "2026-08-31" })],
      august,
    );
    strictEqual(coverage.record_count, 1);
    strictEqual(coverage.observed_start, "2026-08-31");
  });

  it("averages outflows and skips the average when there are none", () => {
    const { data } = summarizeTransactions(
      [txn({ amount: -1000 }), txn({ amount: -1001 }), txn({ amount: 500, category: "income" })],
      { ...august, measures: ["average_outflow"], group_by: ["category"] },
    );
    deepStrictEqual(
      data.map((row) => [row.group?.category, row.value]),
      [["groceries", 1001]],
    );
  });

  it("returns no rows for no transactions", () => {
    const { data, coverage } = summarizeTransactions([], august);
    deepStrictEqual(data, []);
    strictEqual(coverage.observed_start, null);
    strictEqual(coverage.non_empty_period_count, 0);
  });
});

describe("formatAmount", () => {
  it("returns undefined for an unknown currency", () => {
    strictEqual(formatAmount(100, "not-a-currency"), undefined);
  });
});

describe("collectPages", () => {
  const pages = [
    { data: [{ id: "a" }, { id: "b" }], has_more: true },
    { data: [{ id: "c" }], has_more: false },
  ];

  it("follows cursors until has_more is false", async () => {
    const cursors: (string | undefined)[] = [];
    const result = await collectPages(
      async (cursor) => {
        cursors.push(cursor);
        return pages[cursors.length - 1];
      },
      (item) => item.id,
      10,
    );
    deepStrictEqual(cursors, [undefined, "b"]);
    deepStrictEqual(result, { items: [{ id: "a" }, { id: "b" }, { id: "c" }], complete: true });
  });

  it("reports incomplete at the page limit", async () => {
    const result = await collectPages(
      async () => pages[0],
      (item) => item.id,
      1,
    );
    strictEqual(result.complete, false);
  });

  it("reports incomplete when has_more is true but there is no cursor", async () => {
    const result = await collectPages(
      async () => ({ data: [] as { id: string }[], has_more: true }),
      (item) => item.id,
      10,
    );
    strictEqual(result.complete, false);
  });
});
