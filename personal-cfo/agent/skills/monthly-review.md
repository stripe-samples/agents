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
2. **Spending by category.** Call `list_transactions` with `start_date` and
   `end_date` for the month, and paginate until `has_more` is false. Total
   outflows by category and currency. Report refunds and deposits separately.
3. **Recurring and unusual items.** Point out charges that look recurring
   (same merchant, similar amount) and unusually large or new merchants. Label
   these as observed patterns, not certainties.
4. **Month over month.** Compare with the prior month only if you fully
   retrieved both months. Otherwise, skip the comparison and say why.
5. **Caveats.** Name any inaccessible sources, pending or uncategorized
   transactions, stale balances, or pagination that could not finish.

Open with a two- or three-sentence summary, then a short section for each step.
Keep it to observations from the data; do not give investment or tax advice.
