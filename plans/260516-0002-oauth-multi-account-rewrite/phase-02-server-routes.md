# Phase 02 — Server Routes (Effect HttpApi)

**Priority:** High (needed for UI and SDK)
**Status:** DONE
**Depends on:** Phase 01 (Auth.OAuthPool, AuthBrowser must exist)

## Context Links

- Source: `packages/opencode/src/server/routes/provider.ts` (feature branch, 555 lines, Hono)
- Target groups: `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts` (dev, 100 lines)
- Target handlers: `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` (dev, 112 lines)
- API composition: `packages/opencode/src/server/routes/instance/httpapi/api.ts`
- Handler mounting: `packages/opencode/src/server/routes/instance/httpapi/server.ts`

## Overview

Dev uses Effect HttpApi pattern. Routes are split into:
- **groups file**: endpoint declarations (schemas, paths, identifiers)
- **handlers file**: `HttpApiBuilder.group(...)` with implementation logic

The feature branch `provider.ts` uses Hono — all new endpoints must be translated to Effect HttpApi.

## New Endpoints to Add

| Identifier | Method | Path | Group |
|------------|--------|------|-------|
| `auth.removeAccount` | DELETE | `/provider/auth/account` | provider |
| `auth.setActive` | POST | `/provider/auth/active` | provider |
| `auth.updateAccount` | PATCH | `/provider/auth/account` | provider |
| `auth.usage` | GET | `/provider/auth/usage` | provider |
| `provider.browser.sessions` | GET | `/provider/auth/browser-session` | provider |
| `provider.browser.session.status` | GET | `/provider/auth/browser-session/:recordId` | provider |
| `provider.browser.session.setup` | POST | `/provider/auth/browser-session/:recordId/setup` | provider |
| `provider.browser.session.refresh` | POST | `/provider/auth/browser-session/:recordId/refresh` | provider |
| `provider.browser.session.remove` | DELETE | `/provider/auth/browser-session/:recordId` | provider |

Also modify existing `PUT /provider/:providerID` auth set behavior (if it exists) to call
`Auth.addOAuth` for oauth type. Check current `provider.auth` (`PUT /auth/:providerID`) on dev —
it calls `Auth.Service.set`. The `Auth.set` on dev already routes to `addOAuth` logic after rewrite,
so no change needed there.

## Schema Definitions (groups file)

Define all request/response schemas as Effect Schema inline in the group file.
Keep schemas simple — avoid creating separate Schema classes unless reused.

```typescript
// Payload schemas
const RemoveAccountPayload = Schema.Struct({ providerID: Schema.String, recordID: Schema.String })
const SetActivePayload = Schema.Struct({
  providerID: Schema.String,
  recordID: Schema.String,
  namespace: Schema.optional(Schema.String),
})
const UpdateAccountPayload = Schema.Struct({
  providerID: Schema.String,
  recordID: Schema.String,
  namespace: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
})

// Response schemas
const RemoveAccountResult = Schema.Struct({ removed: Schema.Boolean, remaining: Schema.NonNegativeInt })
const SetActiveResult = Schema.Struct({ success: Schema.Boolean, anthropicUsage: Schema.optional(Schema.Any) })
const UpdateAccountResult = Schema.Struct({ success: Schema.Boolean })

// Usage types
const AccountHealth = Schema.Struct({
  successCount: Schema.NonNegativeInt,
  failureCount: Schema.NonNegativeInt,
  lastStatusCode: Schema.optional(Schema.Int),
  cooldownUntil: Schema.optional(Schema.Number),
})
const AccountUsage = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  isActive: Schema.Boolean,
  health: AccountHealth,
})
const AnthropicUsageWindow = Schema.Struct({
  utilization: Schema.NonNegativeInt,
  resetsAt: Schema.optional(Schema.String),
})
const AnthropicUsage = Schema.Struct({
  fiveHour: Schema.optional(AnthropicUsageWindow),
  sevenDay: Schema.optional(AnthropicUsageWindow),
  sevenDaySonnet: Schema.optional(AnthropicUsageWindow),
})
const ProviderUsage = Schema.Struct({
  accounts: Schema.Array(AccountUsage),
  anthropicUsage: Schema.optional(AnthropicUsage),
})
const UsageResult = Schema.Record(Schema.String, ProviderUsage)

// Browser session types
const BrowserSessionStatus = Schema.Struct({
  recordId: Schema.String,
  enabled: Schema.Boolean,
  profilePath: Schema.String,
  lastRefresh: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  isConfigured: Schema.Boolean,
  label: Schema.optional(Schema.String),
})
const BrowserActionResult = Schema.Struct({ success: Schema.Boolean, message: Schema.String })
```

## Implementation Steps

### Step 2.1 — Update `groups/provider.ts`

- [ ] Add `RecordIdParam = Schema.Struct({ recordId: Schema.String })` for browser session params
- [ ] Add all 9 new `HttpApiEndpoint` declarations inside the existing `HttpApiGroup.make("provider")` block
- [ ] Use `described()` helper from `./metadata` for success schemas
- [ ] Annotate each with `OpenApi.annotations({ identifier: "...", summary: "...", description: "..." })`
- [ ] All new endpoints inherit the existing group middleware (InstanceContextMiddleware, WorkspaceRoutingMiddleware, Authorization)

**Endpoint declaration pattern:**
```typescript
HttpApiEndpoint.delete("removeAccount", `${root}/auth/account`, {
  query: WorkspaceRoutingQuery,
  payload: RemoveAccountPayload,
  success: described(RemoveAccountResult, "Account removed"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "auth.removeAccount",
    summary: "Remove OAuth account",
    description: "Remove an OAuth account record from a provider.",
  }),
),
```

**File size:** groups/provider.ts will grow from 100 → ~200 lines. No split needed.

### Step 2.2 — Update `handlers/provider.ts`

- [ ] Import `Auth` from `@/auth` and `AuthBrowser` from `@/auth/browser`
- [ ] Add 9 handler `Effect.fn(...)` functions inside the existing `HttpApiBuilder.group` gen block
- [ ] Register each handler with `.handle("endpointName", handlerFn)`

**Handler implementation pattern (removeAccount):**
```typescript
const removeAccount = Effect.fn("ProviderHttpApi.removeAccount")(function* (ctx: {
  payload: { providerID: string; recordID: string }
}) {
  const result = yield* Effect.tryPromise(() =>
    Auth.OAuthPool.removeRecord(ctx.payload.providerID, ctx.payload.recordID),
  )
  return result
})
```

**Handler for usage:**
```typescript
const getAuthUsage = Effect.fn("ProviderHttpApi.getAuthUsage")(function* () {
  const auth = yield* Effect.tryPromise(() => Auth.all())
  const result: Record<string, unknown> = {}
  for (const [providerID, info] of Object.entries(auth)) {
    if (info.type === "oauth") {
      const accounts = yield* Effect.tryPromise(() => Auth.OAuthPool.getUsage(providerID))
      const anthropicUsage = yield* Effect.tryPromise(() => Auth.OAuthPool.fetchAnthropicUsage(providerID))
      result[providerID] = { accounts, anthropicUsage: anthropicUsage ?? undefined }
    }
  }
  return result
})
```

**Browser session handlers** — wrap `AuthBrowser.*` calls in `Effect.tryPromise`, handle errors
with `Effect.catchAll` returning `{ success: false, message: errorMessage }`.

**File size:** handlers/provider.ts will grow from 112 → ~250 lines. Consider splitting browser
session handlers into `handlers/provider-browser.ts` and importing into `handlers/provider.ts`.

### Step 2.3 — No changes to `api.ts` or `server.ts`

`ProviderApi` is already in `InstanceHttpApi` and `providerHandlers` is already mounted in `server.ts`.
The new endpoints are added inside the existing provider group — no registration changes needed.

## Todo Checklist

- [ ] 2.1 Add schema definitions at top of `groups/provider.ts`
- [ ] 2.1a Add 9 `HttpApiEndpoint` declarations to `HttpApiGroup.make("provider")`
- [ ] 2.2 Add `Auth` + `AuthBrowser` imports to `handlers/provider.ts`
- [ ] 2.2a Implement `removeAccount`, `setActive`, `updateAccount`, `getAuthUsage` handlers
- [ ] 2.2b Implement 5 browser session handlers (`listBrowserSessions`, `getBrowserSession`, `setupBrowserSession`, `refreshBrowserSession`, `removeBrowserSession`)
- [ ] 2.2c Register all 9 new handlers in the `.handle(...)` chain
- [ ] Compile check: `bun tsc --noEmit`
- [ ] Smoke test: start server, hit `GET /provider/auth/usage` via curl

## Success Criteria

- All 9 endpoints defined in OpenAPI spec (verifiable via `/openapi.json`)
- `GET /provider/auth/usage` returns `{ providerID: { accounts: [...], anthropicUsage: {...} } }`
- `POST /provider/auth/active` switches active account
- `DELETE /provider/auth/account` removes a record
- `PATCH /provider/auth/account` renames a record
- Browser session CRUD endpoints work end-to-end
- No TypeScript errors

## Risk Assessment

- **WorkspaceRoutingQuery**: browser session and auth endpoints may not need workspace routing — check if existing non-workspace routes omit this query param. If so, create a variant without it.
- **Effect.tryPromise error handling**: `Auth.OAuthPool.*` throw plain errors — wrap with descriptive `Effect.tryPromise({ try, catch })` rather than `.orDie`
- **Schema annotation for `any`**: `anthropicUsage` uses `Schema.Any` to avoid over-specifying — acceptable here, can be tightened later
