---
description: Use when the user asks for a monthly review, budget check-in, spending summary for a month, or "how did I do" with their money.
---

# Monthly review

Review one calendar month. Use the month the user names; otherwise use the most
recent complete month. Follow financial-insights for field meanings, amounts,
and pagination.

1. **Cash position.** Call `list_balances`. Report `current` per source, plus
   `cash.available` for cash sources and `credit.used` for credit sources.
   Give each balance's `as_of` freshness. Call `list_sources` only if you need
   source names.
2. **Spending by category.** Call `get_txn_summary` once, from the first day of
   the prior month to the last day of the review month, with `granularity:
   "month"`, `group_by: ["category"]`, and `measures: ["outflow", "inflow"]`.
   Report the review month's outflow by category and currency. Inflow includes
   refunds and transfers, so do not call it income.
3. **Recurring and unusual items.** Call `list_transactions` for the month and
   point out charges that look recurring (same description, similar amount) and
   unusually large or new ones. Label these as observed patterns, not
   certainties.
4. **Shopping patterns.** If a Link insight fits, such as top brands per
   shopping category, include it and state its period, which can be longer
   than the month. Skip it if it is pending or unavailable.
5. **Month over month.** Report the `change` and `change_percent` fields
   from the step 2 summary. Compare only if `pagination_complete` is true.
   Otherwise, skip the comparison and say why.
6. **Caveats.** Name any `sources_without_records`, inaccessible insights,
   pending or uncategorized transactions, stale balances, or incomplete
   pagination.

Open with a two- or three-sentence summary, then a short section for each step.
Keep it to observations from the data; do not give investment or tax advice.
