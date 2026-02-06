## Context metrics shared

Unify duplicate session usage calculations

---

### Summary

`session-context-tab.tsx` and `session-context-usage.tsx` both compute overlapping session metrics (cost, last assistant token totals, provider/model context usage). This creates duplicate loops and raises drift risk. We will centralize shared calculations in one helper module and have both components consume it.

---

### Goals

- Compute shared session usage metrics in one place
- Remove duplicate loops for cost and latest-token context usage
- Keep UI output unchanged in both components

---

### Non-goals

- Rewriting the detailed context breakdown estimator logic
- Changing translations or labels
- Moving metrics into backend API responses

---

### Parallel execution contract

This spec owns:

- `packages/app/src/components/session/session-context-tab.tsx`
- `packages/app/src/components/session-context-usage.tsx`
- New helper in `packages/app/src/components/session/*` or `packages/app/src/utils/*`

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/context/sync.tsx`

---

### Implementation plan

1. Add shared metrics helper

- Create helper for raw metrics from message list + provider map, e.g.:
  - `totalCost`
  - `lastAssistantWithTokens`
  - `tokenTotal`
  - `tokenUsagePercent`
  - provider/model labels
- Return raw numeric values; keep locale formatting in consumers.

2. Add memoization guard

- Use reference-based memoization (e.g. by message-array identity) inside helper or component-level memo to avoid duplicate recalculation on unchanged arrays.

3. Migrate both components

- Replace duplicated loops in:
  - `session-context-tab.tsx`
  - `session-context-usage.tsx`
- Keep existing UI structure and i18n keys unchanged.

---

### Acceptance criteria

- Shared cost + token calculations are defined in one module.
- Both components read from the shared helper.
- Rendered values remain identical for:
  - total cost
  - token totals
  - usage percentage
  - provider/model fallback labels

---

### Validation plan

- Manual:
  - Open session context tab and compare values with header/context indicator tooltip.
  - Verify values update correctly while new assistant messages stream in.
- Regression:
  - locale change still formats numbers/currency correctly.

---

### Risks and mitigations

- Risk: helper changes semantic edge cases (no provider, no model, missing token fields).
  - Mitigation: preserve existing fallback behavior (`"—"`, null percent).
- Risk: memoization over-caches stale values.
  - Mitigation: key cache by message-array reference and dependent IDs only.
