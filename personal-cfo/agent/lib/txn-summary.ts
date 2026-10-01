// Deterministic transaction aggregation for get_txn_summary. It follows the
// planned Link get_txn_summary shape so the tool can be replaced by Link's
// own summary tool when it ships. The model reports these numbers; it never
// totals amounts itself.

export const MEASURES = [
  "outflow",
  "inflow",
  "net_cash_flow",
  "transaction_count",
  "average_outflow",
] as const;
export const GRANULARITIES = ["day", "week", "month", "all"] as const;
export const GROUP_BY = ["category", "source"] as const;

export type Measure = (typeof MEASURES)[number];
export type Granularity = (typeof GRANULARITIES)[number];
export type GroupBy = (typeof GROUP_BY)[number];

export interface SummaryTransaction {
  id: string;
  source_id: string | null;
  amount: number;
  currency: string;
  created_date: string;
  category: string | null;
  status: string;
}

export interface SummaryOptions {
  start_date: string;
  end_date: string;
  granularity: Granularity;
  measures: readonly Measure[];
  group_by: readonly GroupBy[];
  filters?: {
    category?: readonly string[];
    flow_type?: "outflow" | "inflow";
    status?: readonly string[];
  };
}

export interface SummaryRow {
  period_start: string;
  period_end: string;
  currency: string;
  group?: { category?: string; source_id?: string };
  measure: Measure;
  value: number;
  formatted?: string;
  previous_value?: number;
  change?: number;
  change_percent?: number;
}

export interface SummaryCoverage {
  requested_start: string;
  requested_end: string;
  observed_start: string | null;
  observed_end: string | null;
  record_count: number;
  currencies: string[];
  period_count: number;
  non_empty_period_count: number;
  status_counts: Record<string, number>;
  uncategorized_count: number;
  unknown_source_count: number;
  included_source_ids: string[];
}

export const UNCATEGORIZED = "uncategorized";
export const UNKNOWN_SOURCE = "unknown";

const MONEY_MEASURES = new Set<Measure>(["outflow", "inflow", "net_cash_flow", "average_outflow"]);

interface Bucket {
  period: Period;
  currency: string;
  group?: SummaryRow["group"];
  outflow: number;
  outflowCount: number;
  inflow: number;
  count: number;
}

interface Period {
  start: string;
  end: string;
}

export function summarizeTransactions(
  transactions: readonly SummaryTransaction[],
  options: SummaryOptions,
): { data: SummaryRow[]; coverage: SummaryCoverage } {
  const { start_date: start, end_date: end, filters = {} } = options;
  const matching = transactions.filter((txn) => {
    const date = txn.created_date.slice(0, 10);
    if (date < start || date > end) return false;
    const category = txn.category ?? UNCATEGORIZED;
    if (filters.category && !filters.category.includes(category)) return false;
    if (filters.status && !filters.status.includes(txn.status)) return false;
    if (filters.flow_type === "outflow" && txn.amount >= 0) return false;
    if (filters.flow_type === "inflow" && txn.amount <= 0) return false;
    return true;
  });

  const buckets = new Map<string, Bucket>();
  for (const txn of matching) {
    const period = periodFor(txn.created_date.slice(0, 10), options);
    const currency = txn.currency.toLowerCase();
    const group = groupFor(txn, options.group_by);
    const key = [period.start, currency, JSON.stringify(group ?? null)].join("|");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { period, currency, group, outflow: 0, outflowCount: 0, inflow: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (txn.amount < 0) {
      bucket.outflow -= txn.amount;
      bucket.outflowCount += 1;
    } else {
      bucket.inflow += txn.amount;
    }
  }

  const sorted = [...buckets.values()].sort(
    (a, b) =>
      a.period.start.localeCompare(b.period.start) ||
      a.currency.localeCompare(b.currency) ||
      JSON.stringify(a.group ?? null).localeCompare(JSON.stringify(b.group ?? null)),
  );
  const data: SummaryRow[] = [];
  for (const bucket of sorted) {
    for (const measure of options.measures) {
      const value = measureValue(bucket, measure);
      if (value === undefined) continue;
      const row: SummaryRow = {
        period_start: bucket.period.start,
        period_end: bucket.period.end,
        currency: bucket.currency,
        ...(bucket.group && { group: bucket.group }),
        measure,
        value,
      };
      if (MONEY_MEASURES.has(measure)) {
        const formatted = formatAmount(value, bucket.currency);
        if (formatted) row.formatted = formatted;
      }
      data.push(row);
    }
  }
  addChanges(data, options);

  const dates = matching.map((txn) => txn.created_date.slice(0, 10)).sort();
  const statusCounts: Record<string, number> = {};
  for (const txn of matching) statusCounts[txn.status] = (statusCounts[txn.status] ?? 0) + 1;

  return {
    data,
    coverage: {
      requested_start: start,
      requested_end: end,
      observed_start: dates[0] ?? null,
      observed_end: dates.at(-1) ?? null,
      record_count: matching.length,
      currencies: [...new Set(matching.map((txn) => txn.currency.toLowerCase()))].sort(),
      period_count: periodsIn(options).length,
      non_empty_period_count: new Set(sorted.map((bucket) => bucket.period.start)).size,
      status_counts: statusCounts,
      uncategorized_count: matching.filter((txn) => txn.category === null).length,
      unknown_source_count: matching.filter((txn) => txn.source_id === null).length,
      included_source_ids: [
        ...new Set(matching.flatMap((txn) => (txn.source_id ? [txn.source_id] : []))),
      ].sort(),
    },
  };
}

function measureValue(bucket: Bucket, measure: Measure): number | undefined {
  switch (measure) {
    case "outflow":
      return bucket.outflow;
    case "inflow":
      return bucket.inflow;
    case "net_cash_flow":
      return bucket.inflow - bucket.outflow;
    case "transaction_count":
      return bucket.count;
    case "average_outflow":
      return bucket.outflowCount > 0 ? Math.round(bucket.outflow / bucket.outflowCount) : undefined;
  }
}

function groupFor(
  txn: SummaryTransaction,
  groupBy: readonly GroupBy[],
): SummaryRow["group"] | undefined {
  if (groupBy.length === 0) return undefined;
  const group: NonNullable<SummaryRow["group"]> = {};
  if (groupBy.includes("category")) group.category = txn.category ?? UNCATEGORIZED;
  if (groupBy.includes("source")) group.source_id = txn.source_id ?? UNKNOWN_SOURCE;
  return group;
}

// Adds each row's change from the same group, currency, and measure in the
// period before it. Rows without a matching earlier row get no change fields.
function addChanges(data: SummaryRow[], options: SummaryOptions): void {
  if (options.granularity === "all") return;
  const periods = periodsIn(options).map((period) => period.start);
  const byKey = new Map<string, SummaryRow>();
  const keyOf = (row: SummaryRow, periodStart: string) =>
    [periodStart, row.currency, JSON.stringify(row.group ?? null), row.measure].join("|");
  for (const row of data) byKey.set(keyOf(row, row.period_start), row);
  for (const row of data) {
    const index = periods.indexOf(row.period_start);
    if (index <= 0) continue;
    const previous = byKey.get(keyOf(row, periods[index - 1]));
    if (!previous) continue;
    row.previous_value = previous.value;
    row.change = row.value - previous.value;
    if (previous.value !== 0) {
      row.change_percent = Math.round((row.change / Math.abs(previous.value)) * 1000) / 10;
    }
  }
}

// Formats an integer minor-unit amount, such as 152340 USD as "$1,523.40".
// Returns undefined for currency codes Intl does not recognize.
export function formatAmount(amount: number, currency: string): string | undefined {
  try {
    const format = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount / 10 ** digits);
  } catch {
    return undefined;
  }
}

// Periods are inclusive YYYY-MM-DD ranges, clipped to the requested range.
// Weeks start on Monday.
export function periodsIn(options: SummaryOptions): Period[] {
  const periods: Period[] = [];
  let date = options.start_date;
  while (date <= options.end_date) {
    const period = periodFor(date, options);
    periods.push(period);
    date = addDays(period.end, 1);
  }
  return periods;
}

function periodFor(date: string, options: SummaryOptions): Period {
  let start: string;
  let end: string;
  switch (options.granularity) {
    case "day":
      start = end = date;
      break;
    case "week": {
      const weekday = (toUtc(date).getUTCDay() + 6) % 7;
      start = addDays(date, -weekday);
      end = addDays(start, 6);
      break;
    }
    case "month": {
      const next = toUtc(`${date.slice(0, 7)}-01`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      start = `${date.slice(0, 7)}-01`;
      end = addDays(next.toISOString().slice(0, 10), -1);
      break;
    }
    case "all":
      start = options.start_date;
      end = options.end_date;
      break;
  }
  return {
    start: start < options.start_date ? options.start_date : start,
    end: end > options.end_date ? options.end_date : end,
  };
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function addDays(date: string, days: number): string {
  const result = toUtc(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

// Reads pages until has_more is false. Stops early, and reports the result as
// incomplete, at maxPages or when a page gives no cursor to continue from.
export async function collectPages<T>(
  list: (startingAfter: string | undefined) => Promise<{ data: T[]; has_more?: boolean }>,
  cursorOf: (item: T) => string | null | undefined,
  maxPages: number,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await list(cursor);
    items.push(...result.data);
    if (!result.has_more) return { items, complete: true };
    const last = result.data.at(-1);
    const next = last ? cursorOf(last) : undefined;
    if (!next) break;
    cursor = next;
  }
  return { items, complete: false };
}
