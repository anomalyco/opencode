# Feature Branch Analysis: feat/oauth-multi-account

**Branch:** `feat/oauth-multi-account`
**Purpose:** Multi-account OAuth support with per-account rotation, health tracking, browser-based auto-relogin

---

## 1. `packages/opencode/src/auth/index.ts` — Multi-Account Store

### Store Format (v2)

```
StoreFile { version: 2, providers: Record<providerID, ProviderEntry> }

ProviderEntry = OAuthProvider | ApiProvider | WellKnownProvider

OAuthProvider {
  type: "oauth"
  active: Record<namespace, recordID>   // which record is "active" per namespace
  order: Record<namespace, recordID[]>  // ordered list for rotation
  records: OAuthRecord[]
}

OAuthRecord {
  id: string (ulid)
  namespace: string (default: "default")
  label?: string
  accountId?: string
  enterpriseUrl?: string
  refresh: string
  access: string
  expires: number
  createdAt: number
  updatedAt: number
  health: Health
}

Health {
  cooldownUntil?: number
  lastStatusCode?: number
  lastErrorAt?: number
  successCount: number
  failureCount: number
}
```

**Legacy migration:** v1 (flat `Record<providerID, Info>`) auto-migrated to v2 on first read. Each old oauth entry becomes a single `OAuthRecord` with `namespace="default"` and `label="default"`.

### File Locking

- File-based lock via `auth.json.lock`
- `withStoreLock`: blocks up to 5s with stale-lock detection (30s)
- `updateStoreBestEffort`: short 250ms timeout, silently skips if busy — used for non-critical health updates (outcome recording, moveToBack)
- Atomic write: temp file → rename

### Key Exports

| Export | Description |
|--------|-------------|
| `Auth.get(providerID)` | Returns active record's tokens as `Info`. Checks `AsyncLocalStorage` context first for per-request account override |
| `Auth.set(key, info)` | Upserts a credential. For OAuth: finds existing by refresh token or context recordID; creates new record if neither matches. Auto-labels: first = "default", subsequent = "Account N" |
| `Auth.remove(key)` | Deletes entire provider entry |
| `Auth.all()` | Returns active record per provider |
| `Auth.addOAuth(providerID, input)` | Explicit add with optional namespace/label |

### `Auth.OAuthPool` Namespace

| Method | Description |
|--------|-------------|
| `snapshot(providerID, ns)` | Returns `{records, orderedIDs, activeID}` — used by rotating fetch |
| `list(providerID, ns)` | Returns `OAuthRecordMeta[]` (no tokens) |
| `orderedIDs(providerID, ns)` | Rotation order |
| `moveToBack(providerID, ns, recordID)` | Deprioritizes a failed record; updates `active` to first remaining |
| `recordOutcome(...)` | Updates health: success/failure counts, cooldown, last status |
| `markAccessExpired(...)` | Clears access token & expires to force refresh on next use |
| `getUsage(providerID, ns)` | Returns usage/health stats per account for UI display |
| `setActive(providerID, ns, recordID)` | Manually promote record to front of order, set as active |
| `updateRecord(providerID, recordID, ns, update)` | Partial update: access, refresh, expires, label |
| `removeRecord(providerID, recordID, ns)` | Delete a single record; cleans up active/order/provider as needed |
| `fetchAnthropicUsage(providerID, ns, recordID?)` | Calls `https://api.anthropic.com/api/oauth/usage` to get rate limit utilization |

---

## 2. `packages/opencode/src/auth/context.ts` — Per-Request Account Context

Uses Node.js `AsyncLocalStorage` to thread a specific `recordID` through a request scope.

```typescript
// Read: returns undefined if no context
getOAuthRecordID(providerID: string): string | undefined

// Write: runs fn() with providerID→recordID bound
withOAuthRecord<T>(providerID, recordID, fn): T
```

Used by `rotating-fetch.ts` to ensure that during a retry with a specific account, `Auth.get()` returns the correct record's tokens.

---

## 3. `packages/opencode/src/auth/credential-manager.ts` — Failover Notifications

Publishes two bus events when rotating to a new account:

1. `credential.failover` — structured event with `{providerID, fromRecordID, toRecordID, statusCode, message}`
2. `TuiEvent.ToastShow` — user-visible warning toast (default 8s duration)

Message is customized: 429 → "Rate limited", 0 → "Request failed", else "Auth error".

---

## 4. `packages/opencode/src/auth/rotating-fetch.ts` — Rotation Logic

`createOAuthRotatingFetch(fetchFn, opts)` wraps any fetch function with multi-account rotation.

### Options
```typescript
{
  providerID: string
  namespace?: string           // default "default"
  maxAttempts?: number         // defaults to candidate count
  rateLimitCooldownMs?: number // default 30s
  authFailureCooldownMs?: number // default 5min
  networkRetryAttempts?: number  // default 1
  toastDurationMs?: number
}
```

### Rotation Algorithm

1. `Auth.OAuthPool.snapshot()` to get all candidates
2. Prefer `activeID` first, then ordered list
3. Body replayability check — if non-replayable, `maxAttempts=1`
4. For each attempt:
   - Pick next non-attempted, non-cooldown candidate
   - Run fetch wrapped in `withOAuthRecord(providerID, recordID, () => fetchFn(...))`
   - **On success**: `recordOutcome(ok: true)`, return
   - **On 429**: parse `Retry-After`, set cooldown, `moveToBack`, notify failover, drain body, continue
   - **On 401/403**: mark access expired, retry same account once (triggers token refresh); if retry fails → set 5min cooldown, `moveToBack`, notify failover
   - **On network error**: retry up to `networkRetryAttempts` times, then throw (no rotation on pure network errors)
   - **On throw with "Token refresh failed"**: attempt `attemptBrowserRelogin()` once per account; if success, retry; else rotate

### Auto-Relogin (2-min timeout)

`attemptBrowserRelogin(providerID, recordID, namespace)`:
1. Check `AuthBrowser.status(recordID).isConfigured`
2. Show "Token expired. Attempting automatic refresh..." toast
3. Call `AuthBrowser.refresh(recordID)` — headless browser PKCE flow
4. On success: `Auth.OAuthPool.updateRecord(...)` with new tokens, show success toast
5. On failure: show error toast, return false

---

## 5. `packages/opencode/src/auth/browser.ts` — Browser Session Management (828 lines)

Manages per-account Chromium browser profiles for headless token refresh.

### Storage Layout
```
~/.local/share/opencode/browsers/anthropic/<recordId>/
  <chromium profile data>
  .opencode-meta.json  { lastRefresh, lastError }
```

### Interfaces
```typescript
OAuthTokens { access: string, refresh: string, expires: number }
BrowserSessionStatus {
  recordId: string, enabled: boolean, profilePath: string,
  lastRefresh?: number, lastError?: string, isConfigured: boolean
}
```

### `AuthBrowser` Namespace Exports

| Method | Description |
|--------|-------------|
| `isConfigured(recordId)` | Check if profile dir exists |
| `status(recordId)` | Returns `BrowserSessionStatus` + meta file data |
| `listAll()` | Scan `browsers/anthropic/` dir, return all session statuses |
| `setup(recordId, onProgress?)` | **Visible browser** — opens chrome UI, PKCE flow, waits up to 10min for user login, polls for callback URL, extracts code, exchanges for tokens, saves profile |
| `refresh(recordId)` | **Headless browser** — reuses saved profile, auto-navigates to authorize, auto-clicks Authorize button (language-agnostic strategy: finds primary button by background color), extracts code, exchanges tokens |
| `remove(recordId)` | Deletes profile dir |

### OAuth Constants (Anthropic-specific)
```
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTHORIZE = "https://claude.ai/oauth/authorize"
TOKEN = "https://console.anthropic.com/v1/oauth/token"
CALLBACK = "https://console.anthropic.com/oauth/code/callback"
CALLBACK_ALT = "https://platform.claude.com/oauth/code/callback"
```

### Puppeteer Bootstrap
- First tries standard `node_modules/puppeteer-extra`
- Falls back to `~/.local/share/opencode/puppeteer/` (auto-installs via bun/npm)
- Uses `puppeteer-extra-plugin-stealth` to avoid bot detection
- Cached singleton to prevent double plugin registration
- 30s launch timeout via `Promise.race`
- `killExistingBrowser()` removes `SingletonLock` + `pkill -9` before launching

---

## 6. `packages/opencode/src/config/config.ts` — OAuth Rotation Config

New `oauth` field added to `ProviderConfig`:

```typescript
Provider.oauth: {
  rateLimitCooldownMs?: number    // 429 cooldown override
  authFailureCooldownMs?: number  // 401/403 cooldown override
  networkRetryAttempts?: number   // retries before giving up on network errors
  maxAttempts?: number            // max accounts to try per request
  toastDurationMs?: number        // failover toast duration
}
```

Located within the per-provider config object (alongside existing `options`).

---

## 7. `packages/opencode/src/server/routes/provider.ts` — New API Routes

All new routes added to `ProviderRoutes`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/usage` | Per-provider account usage/health stats + Anthropic rate limit utilization |
| POST | `/auth/active` | Set active OAuth account for a provider |
| DELETE | `/auth/account` | Remove an OAuth account record |
| PATCH | `/auth/account` | Update account label |
| GET | `/auth/browser-session` | List all browser sessions with account labels |
| GET | `/auth/browser-session/:recordId` | Get single session status |
| POST | `/auth/browser-session/:recordId/setup` | Run visible browser setup, save tokens |
| POST | `/auth/browser-session/:recordId/refresh` | Run headless refresh, save tokens |
| DELETE | `/auth/browser-session/:recordId` | Remove browser session profile |

---

## 8. `packages/opencode/src/cli/cmd/auth.ts` — New CLI Commands

New top-level `auth browser` subcommand tree:

```
auth browser list/ls       - list configured browser sessions
auth browser setup [id]    - open visible browser to configure session
auth browser refresh [id]  - test/refresh tokens headlessly
auth browser remove [id]   - remove session profile
auth rename [id] [name]    - rename an OAuth account label
```

`AuthLoginCommand`: unchanged but calls `Auth.set()` which now handles multi-account logic.

`AuthLogoutCommand`: unchanged — removes entire provider (all accounts).

---

## Integration Points

1. **Rotating fetch wiring**: `createOAuthRotatingFetch` must be applied at the provider fetch level. The feature branch threads `providerID` + rotation opts from provider config's `oauth` field.
2. **`Auth.get()` still works**: backwards compatible — returns the active account's tokens, just as before.
3. **`Auth.set()` is multi-account-aware**: new oauth adds records, existing refresh token = update in place, same context recordID = update that specific record.
4. **Bus events**: `credential.failover` event and TUI toast integration for UX feedback during rotation.
5. **Context propagation**: `withOAuthRecord` ensures the correct token is used even when rotating mid-request.

---

## Unresolved Questions

1. How does `createOAuthRotatingFetch` get wired into the provider SDK calls in the `dev` branch? Need to check `provider/auth.ts` or provider factory to understand injection point.
2. The `oauth` config field in `ProviderConfig` — is this already on `dev` branch or needs to be added?
3. Browser auto-relogin is Anthropic-specific (hardcoded `CLIENT_ID`, URLs). Is that intentional or should it be extensible?
4. `Auth.all()` on `dev` branch — does it still use the v1 flat format? Migration path needs verifying.
5. The `AuthBrowserCommand` is added to `AuthCommand` builder — need to check if `dev` branch has the full `auth.ts` file or if subcommand wiring changed.
