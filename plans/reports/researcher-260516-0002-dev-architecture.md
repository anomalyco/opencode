# Dev Branch Architecture Research
**Branch:** `feat/oauth-multi-account` (based on dev)
**Date:** 2026-05-16
**Purpose:** Understand existing auth/provider/routes/SDK patterns for multi-account OAuth rewrite

---

## 1. Auth System (`packages/opencode/src/auth/index.ts`)

### Pattern
Plain TypeScript namespace (`Auth`) — NOT Effect Schema. Uses Zod for schema validation, file-based persistence at `Global.Path.data/auth.json`, with file-locking via a `.lock` file.

### Store Format (v2)
```ts
StoreFile = { version: 2, providers: Record<providerID, ProviderEntry> }
ProviderEntry = OAuthProvider | ApiProvider | WellKnownProvider

OAuthProvider = {
  type: "oauth"
  active: Record<namespace, recordID>   // which record is active per namespace
  order: Record<namespace, recordID[]>  // ordered list per namespace (for rotation)
  records: OAuthRecord[]                // all OAuth accounts
}
OAuthRecord = {
  id: string (ulid)
  namespace: string (default: "default")
  label?: string (auto: "default", "Account 2", etc.)
  accountId?: string
  enterpriseUrl?: string
  refresh: string
  access: string
  expires: number
  createdAt/updatedAt: number
  health: { successCount, failureCount, lastStatusCode, cooldownUntil, lastErrorAt }
}
```

### Legacy Migration
On read, if the file is v1 (flat `Record<providerID, Info>`), it auto-migrates to v2, creating a single `default` namespace record per OAuth provider.

### Public API
- `Auth.get(providerID)` — returns `Info` (single oauth/api/wellknown) for the active record in `default` namespace. Respects `AsyncLocalStorage` context (rotating-fetch injects per-request record ID via `withOAuthRecord`)
- `Auth.all()` — returns `Record<providerID, Info>` (one per provider, the active record)
- `Auth.set(key, info)` — upserts; for OAuth, matches by refresh token OR context record ID to avoid creating duplicate records on token refresh. Creates new record if neither matches (new account login)
- `Auth.remove(key)` — deletes entire provider entry (removes ALL accounts)
- `Auth.addOAuth(providerID, input)` — explicitly add a new OAuth record with optional namespace/label
- `Auth.OAuthPool.*` — multi-account management sub-namespace:
  - `snapshot/list/orderedIDs` — read pool state
  - `setActive(providerID, namespace, recordID)` — switch active account
  - `moveToBack(...)` — rotate exhausted account to back
  - `recordOutcome(...)` — update health/cooldown after request
  - `markAccessExpired(...)` — force token refresh
  - `removeRecord(...)` — remove single account (not whole provider)
  - `updateRecord(...)` — update label/tokens
  - `getUsage(...)` — account health summary for UI
  - `fetchAnthropicUsage(...)` — fetch Anthropic rate limit API (anthropic-only)

### Locking
- `withStoreLock()` — 5s timeout, 30s stale detection, 25ms retry jitter. Normal operations.
- `updateStoreBestEffort()` — 250ms timeout, 10ms retry. Used for health/cooldown updates (non-critical).

### Context (context.ts)
`AsyncLocalStorage`-based. `withOAuthRecord(providerID, recordID, fn)` injects a specific record ID into the execution context. `getOAuthRecordID(providerID)` reads it. Used by `rotating-fetch.ts` so that `Auth.set()` during a token refresh updates the *same* record, not creates a new one.

---

## 2. Provider System (`packages/opencode/src/provider/provider.ts`)

### Pattern
Plain namespace `Provider`. No Effect. State is managed via `Instance.state(...)` — lazily initialized per workspace instance.

### How Auth Is Consumed
Providers are loaded in priority order:
1. Env vars (API keys from process.env matching `provider.env[]`)
2. `Auth.all()` — api-type entries set `provider.key`
3. Plugin auth hooks (github-copilot, etc.)
4. `CUSTOM_LOADERS` per providerID — these call `Auth.get(providerID)` for OAuth access tokens

OAuth is wired in `getSDK()` via `createOAuthRotatingFetch(fetch, { providerID, ...oauthConfig })`. This wraps the SDK's fetch function to auto-rotate accounts on rate limits.

### Config OAuth Settings (config.ts lines 954-973)
```ts
provider[id].oauth = {
  rateLimitCooldownMs?: number
  authFailureCooldownMs?: number
  networkRetryAttempts?: number
  maxAttempts?: number
  toastDurationMs?: number
}
```

---

## 3. Server Routes (`packages/opencode/src/server/`)

### Framework
**Hono** with `hono-openapi` for OpenAPI spec generation. Routes use `describeRoute` + `validator()` for typed handlers.

### Route Registration Pattern (`server.ts`)
```ts
const app = new Hono()
app
  .route("/provider", ProviderRoutes())
  .route("/session", SessionRoutes())
  // inline routes for auth:
  .put("/auth/:providerID", ...)
  .delete("/auth/:providerID", ...)
  .delete("/auth/account", ...)
  .get("/auth/usage", ...)
  .post("/auth/active", ...)
```

### Auth routes split between server.ts (top-level) and routes/provider.ts

**In `server.ts` (top-level, before workspace middleware):**
- `PUT /auth/:providerID` — `Auth.set(providerID, Info)` (set api/oauth/wellknown)
- `DELETE /auth/:providerID` — `Auth.remove(providerID)` (removes all accounts for provider)
- `DELETE /auth/account` — `Auth.OAuthPool.removeRecord(...)` (remove single OAuth record)
- `GET /auth/usage` — returns OAuthPool.getUsage + fetchAnthropicUsage per provider
- `POST /auth/active` — `Auth.OAuthPool.setActive(...)` + return anthropicUsage

**In `routes/provider.ts` (under /provider prefix, after workspace middleware):**
- `GET /provider/` — list all providers
- `GET /provider/auth` — ProviderAuth methods
- `POST /provider/:providerID/oauth/authorize` — start OAuth flow
- `POST /provider/:providerID/oauth/callback` — handle callback
- `GET /provider/auth/usage` — (DUPLICATE of server.ts /auth/usage — same logic)
- `POST /provider/auth/active` — (DUPLICATE of server.ts /auth/active)
- `DELETE /provider/auth/account` — (DUPLICATE of server.ts /auth/account)
- `PATCH /provider/auth/account` — update account label
- `GET /provider/auth/browser-session` — list browser sessions
- `GET /provider/auth/browser-session/:recordId` — get status
- `POST /provider/auth/browser-session/:recordId/setup` — open browser for login
- `POST /provider/auth/browser-session/:recordId/refresh` — headless refresh
- `DELETE /provider/auth/browser-session/:recordId` — remove session

**Note:** There are currently duplicate routes for `/auth/usage`, `/auth/active`, and `/auth/account` in both server.ts and routes/provider.ts. The provider routes appear to be the "intended" location but both exist.

### Workspace middleware
Applied mid-chain in server.ts. Routes registered BEFORE the workspace middleware (`/global`, inline auth routes) don't require workspace context. Routes registered AFTER (via `.route(...)` calls) do.

---

## 4. SDK Generation

### Process
`packages/sdk/js/script/build.ts`:
1. `bun dev generate` on the opencode package → outputs `openapi.json`
2. `@hey-api/openapi-ts` generates TypeScript client from spec into `src/v2/gen/`
3. Build with `bun tsc`

### Key Config
- Generator: `@hey-api/openapi-ts` v0.90.10
- Output: `packages/sdk/js/src/v2/gen/`
- Client instance name: `OpencodeClient`
- Auth disabled at SDK level (auth handled by server)
- Params structure: flat

### What triggers re-generation
Running `bun run build` in `packages/sdk/js/`. Must be done after any route/schema changes. OpenAPI spec is derived from `describeRoute`/`resolver` annotations on Hono routes.

---

## 5. Auth CLI (`packages/opencode/src/cli/cmd/auth.ts`)

Commands:
- `auth login [url]` — select provider, handle plugin auth or prompt for API key; calls `Auth.set()`
- `auth logout` — select provider, calls `Auth.remove()` (removes ALL accounts for that provider)
- `auth list` — calls `Auth.all()`, shows type per provider
- `auth browser list/setup/refresh/remove` — manage browser sessions per Anthropic account
- `auth rename [recordId] [name]` — calls `Auth.OAuthPool.updateRecord()`

**Limitation:** `auth login` for OAuth always creates a new account (due to `Auth.set()` logic). No explicit "add second account" flow in CLI yet — just re-running login creates a new record when there's no matching refresh token.

---

## 6. Provider Settings UI (`packages/app/src/components/settings-providers.tsx`)

### Structure
SolidJS component. Three view states: `"list"` | `"add"` | `{ detail: providerID }`.

**List view:** Shows connected providers with "Multi-account" badge (from `OAUTH_MULTI_ACCOUNT_SUPPORT` lookup). Click → detail view.

**Detail view (`ProviderDetailView`):**
- Loads usage via `globalSDK.client.auth.usage({})` (SDK call to `/auth/usage`)
- Shows Anthropic rate limit bars (fiveHour, sevenDay, sevenDaySonnet)
- Per-account list with: active indicator, cooldown status, request count, rename inline edit
- Switch account: POST `/auth/active`
- Delete account: DELETE `/auth/account`
- Auto-Relogin section (Anthropic only): browser session setup/refresh/rebind/remove
- Add Account button → opens `DialogConnectProvider`

**Multi-account support table (hardcoded in component):**
- Supported: anthropic, openai, github-copilot
- Not supported: google, openrouter, azure, amazon-bedrock, etc.

---

## 7. Test Patterns (`packages/opencode/test/auth/auth.test.ts`)

- Uses `bun:test` (test/expect/afterEach)
- Tests call `Auth.*` functions directly (no mocking)
- `afterEach` cleanup: `Auth.remove("https://example.com")` + `Auth.remove("anthropic")` — essential for test isolation
- Tests cover: trailing slash normalization, legacy key cleanup, no-op cases
- Currently only 4 tests, all on `Auth.set/remove/all` basics

---

## Key Architecture Insights for Multi-Account Rewrite

1. **Storage is ready.** The v2 schema fully supports multi-account per provider with namespaced records, ordering, active pointer, health tracking. No schema changes needed.

2. **Rotation is implemented.** `rotating-fetch.ts` + `Auth.OAuthPool.moveToBack/recordOutcome` handle automatic rotation. The `OAUTH_MULTI_ACCOUNT_SUPPORT` in the UI is a frontend-only display concern.

3. **Route duplication.** `/auth/usage`, `/auth/active`, `/auth/account` exist in both `server.ts` (top-level) and `routes/provider.ts` (under `/provider`). The UI appears to use the `/auth/*` prefix for some endpoints and `/provider/auth/*` for others. Should be consolidated.

4. **SDK must be regenerated** after any route changes by running `bun run build` in `packages/sdk/js/`.

5. **`Auth.remove()` removes ALL accounts.** There's no provider-level "disconnect but keep records" — `remove()` deletes the entire entry. For multi-account, the UI uses `removeRecord()` which can cleanly remove individual accounts.

6. **Namespace concept exists but UI only uses "default".** The `namespace` field in OAuthRecord/OAuthPool is plumbed throughout but all CLI/UI code hardcodes `"default"`. This could be used for workspace-scoped accounts in future.

7. **`Auth.addOAuth()` vs `Auth.set()`.** `addOAuth()` is the explicit "add new account" path. `Auth.set()` is the "upsert" path that tries to match existing records first. The CLI `auth login` uses `Auth.set()`, so re-logging in as same account updates rather than duplicates.

---

## Unresolved Questions

1. Why are `/auth/usage`, `/auth/active`, and `/auth/account` duplicated between `server.ts` and `routes/provider.ts`? Which prefix does the SDK client call?
2. The dev branch commit `613562f50` ("make account login upgrades safe while adding multi-account workspace auth") — what exactly did it change vs this branch? (git access blocked)
3. Does `OAUTH_MULTI_ACCOUNT_SUPPORT` need to be moved server-side (driven by ProviderAuth methods) rather than hardcoded in the UI?
4. Is there intent to support non-"default" namespaces for workspace-scoped accounts?
