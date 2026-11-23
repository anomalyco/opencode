# usage

## GET /api/experimental/usage/limits (experimental)

Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.

Returns: `{ location: Location.PublicRef; data: UsageLimits.Info }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `UsageLimits.Budget`: `{ id, limit, spent, scope, per, coverage, models, vendors, inputPriceAtLeast, picked, shared, resetsAt }`
- `UsageLimits.Go`: `{ rolling: UsageLimits.Meter; weekly: UsageLimits.Meter; monthly: UsageLimits.Meter }`
- `UsageLimits.Info`: `{ workspace: { id, name, usageURL }; go?: UsageLimits.Go; budgets: UsageLimits.Budget[] }`
- `UsageLimits.Meter`: `{ percent: number; limited: boolean; resetsAt: number }`
