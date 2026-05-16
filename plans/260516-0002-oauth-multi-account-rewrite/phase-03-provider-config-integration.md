# Phase 03 — Provider + Config Integration

**Priority:** High
**Status:** DONE
**Depends on:** Phase 01 (auth/rotating-fetch.ts must exist)

## Context Links

- Source: `packages/opencode/src/provider/provider.ts` (feature branch, grep `createOAuthRotatingFetch`)
- Source: `packages/opencode/src/config/config.ts` (feature branch, lines 554, 954 — oauth fields)
- Target: `packages/opencode/src/provider/provider.ts` (dev)
- Target: `packages/opencode/src/config/provider.ts` (dev — per-provider config, no oauth field yet)

## Overview

Two additions needed:

1. **`config/provider.ts`** — add `oauth` optional field to provider config schema
2. **`provider/provider.ts`** — wire `createOAuthRotatingFetch` into the fetch pipeline

Both files already exist on dev; these are additive changes only.

## Part A — Config Schema Addition

### File: `packages/opencode/src/config/provider.ts`

Dev's `ConfigProvider.Info` is an Effect Schema `Schema.Struct`. Add `oauth` field:

```typescript
// Add to ConfigProvider.Info struct fields:
oauth: Schema.optional(
  Schema.Struct({
    rateLimitCooldownMs: Schema.optional(
      Schema.Int.pipe(Schema.positive()).annotate({ description: "Cooldown ms after 429 response" }),
    ),
    authFailureCooldownMs: Schema.optional(
      Schema.Int.pipe(Schema.positive()).annotate({ description: "Cooldown ms after 401/403 response" }),
    ),
    networkRetryAttempts: Schema.optional(
      Schema.NonNegativeInt.annotate({ description: "Number of network error retries" }),
    ),
    maxAttempts: Schema.optional(
      Schema.Int.pipe(Schema.positive()).annotate({ description: "Max rotation attempts across accounts" }),
    ),
    toastDurationMs: Schema.optional(
      Schema.Int.pipe(Schema.positive()).annotate({ description: "Toast display duration ms on failover" }),
    ),
  }).annotate({ description: "OAuth rotation and health-tracking configuration" }),
),
```

**Note:** Dev uses Effect Schema (`Schema.Int`, `Schema.positive()`, etc.) not Zod.
Equivalent Zod validators from feature branch:
- `z.number().int().positive()` → `Schema.Int.pipe(Schema.positive())`
- `z.number().int().nonnegative()` → `Schema.NonNegativeInt`

### Step 3.1 Checklist

- [ ] Open `packages/opencode/src/config/provider.ts`
- [ ] Locate the `Info` struct definition
- [ ] Add `oauth: Schema.optional(Schema.Struct({...}))` field after existing fields
- [ ] Verify `Config.Service.get()` callers can access `config.provider?.[id]?.oauth` (plain object access, no change needed)

## Part B — Provider.ts Rotating Fetch Wiring

### File: `packages/opencode/src/provider/provider.ts`

On the feature branch, rotating fetch is wired inside the SDK initialisation function
(the function that builds the AI SDK provider instance). The pattern:

```typescript
// Feature branch pattern (lines ~1125-1133):
const oauthConfig = config.provider?.[model.providerID]?.oauth
options["fetch"] = createOAuthRotatingFetch(fetchWithTimeout, {
  providerID: model.providerID,
  maxAttempts: oauthConfig?.maxAttempts,
  rateLimitCooldownMs: oauthConfig?.rateLimitCooldownMs,
  authFailureCooldownMs: oauthConfig?.authFailureCooldownMs,
  networkRetryAttempts: oauthConfig?.networkRetryAttempts,
  toastDurationMs: oauthConfig?.toastDurationMs,
})
```

On dev, `provider.ts` has a different structure (Effect-based Service). The equivalent
location is wherever the provider SDK instance is created and a `fetch` option is set.

### Step 3.2 — Locate insertion point in dev `provider/provider.ts`

- [ ] Search for `fetch` option assignment in `provider.ts` (where `options["fetch"]` or `fetchFn` is set)
- [ ] Search for where `config.provider?.[providerID]` is accessed for per-provider options
- [ ] Find the function that constructs the AI SDK instance (likely `loadSdk` or similar)

### Step 3.3 — Add import

```typescript
import { createOAuthRotatingFetch } from "@/auth/rotating-fetch"
```

### Step 3.4 — Wire rotating fetch

After identifying insertion point, add:

```typescript
const oauthConfig = config.provider?.[model.providerID]?.oauth
options["fetch"] = createOAuthRotatingFetch(existingFetchFn, {
  providerID: model.providerID,
  maxAttempts: oauthConfig?.maxAttempts,
  rateLimitCooldownMs: oauthConfig?.rateLimitCooldownMs,
  authFailureCooldownMs: oauthConfig?.authFailureCooldownMs,
  networkRetryAttempts: oauthConfig?.networkRetryAttempts,
  toastDurationMs: oauthConfig?.toastDurationMs,
})
```

**Important:** `createOAuthRotatingFetch` is a no-op passthrough when the provider has zero
OAuth records (it returns `fetchFn(input, init)` directly). It is safe to wrap all providers —
only those with OAuth accounts in the store will use rotation logic.

### Step 3.5 — Verify `config` access

On dev, `Config.Service` provides config via Effect. Inside the provider SDK init:
- If config is accessed as `yield* cfg.get()` (Effect), `oauthConfig` reads from that
- If config is accessed as a plain object already passed in, use that reference
- Match the existing access pattern — do not add a new `Config.Service` yield

## Todo Checklist

- [ ] 3.1 Add `oauth` field to `Schema.Struct` in `packages/opencode/src/config/provider.ts`
- [ ] 3.2 Find fetch-option assignment in dev `provider/provider.ts`
- [ ] 3.3 Add `createOAuthRotatingFetch` import
- [ ] 3.4 Insert rotating fetch wrapper at identified location
- [ ] Compile check: `bun tsc --noEmit`
- [ ] Manual test: add two Anthropic OAuth accounts, send a request — verify rotation

## Success Criteria

- `config.provider.anthropic.oauth.rateLimitCooldownMs` is accepted in `opencode.json`
- Provider SDK fetch is wrapped with `createOAuthRotatingFetch` for all providers
- When a provider has 0 OAuth records, behaviour is unchanged (passthrough)
- When a provider has 2+ OAuth records and one hits 429, rotation occurs

## Risk Assessment

- **Dev provider.ts structure**: dev uses Effect Services so the SDK init may be inside an Effect gen function — `createOAuthRotatingFetch` is plain async and can be called normally inside `Effect.gen` without yielding
- **fetchWithTimeout reference**: the existing `fetchWithTimeout` or equivalent on dev must be identified before wrapping — do not double-wrap if already wrapped elsewhere
- **Schema.positive()**: verify this combinator exists in the Effect version used on dev; fallback is `Schema.filter((n) => n > 0)`
