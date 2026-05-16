# Phase 01 — Auth Store Rewrite

**Priority:** Critical (all other phases depend on this)
**Status:** DONE
**Effort:** Large — replaces core auth module and adds 4 new files

## Context Links

- Source: `packages/opencode/src/auth/index.ts` (feature branch, 799 lines)
- Source: `packages/opencode/src/auth/context.ts` (feature branch)
- Source: `packages/opencode/src/auth/credential-manager.ts` (feature branch)
- Source: `packages/opencode/src/auth/rotating-fetch.ts` (feature branch)
- Source: `packages/opencode/src/auth/browser.ts` (feature branch)
- Target: `packages/opencode/src/auth/index.ts` (dev, 96 lines — Effect Schema Service)

## Overview

Dev's `auth/index.ts` is a thin Effect Schema Service with `get/all/set/remove` returning `Effect`.
The feature branch has a full Zod-based multi-account store. We need to:

1. Replace the dev `auth/index.ts` with the feature branch version, adapted for Effect Schema types
2. Copy `context.ts`, `credential-manager.ts`, `rotating-fetch.ts`, `browser.ts` as-is (they use plain TS, not Zod — minimal changes needed)

## Key Architecture Decision

```
Auth.Service (Effect Context.Service) — satisfies Effect layer callers
  ├── get(providerID) → Effect<Info | undefined>
  ├── all() → Effect<Record<string, Info>>
  ├── set(key, info) → Effect<void>
  └── remove(key) → Effect<void>

Auth.OAuthPool (plain async namespace) — no Effect wrapper
  ├── list / snapshot / orderedIDs
  ├── moveToBack / recordOutcome / markAccessExpired
  ├── getUsage / setActive / updateRecord / removeRecord
  └── fetchAnthropicUsage

Auth.addOAuth(providerID, input) — plain async, used by server routes
```

**Critical:** `Auth.Service` methods must wrap the async store functions in `Effect.tryPromise`.
The `Auth.OAuthPool.*` functions stay as plain `async` — they're called from Hono-style handlers
AND from rotating-fetch, neither of which use Effect.

## Schema Changes (Zod → Effect Schema)

Dev uses Effect Schema classes. The store internal types (`OAuthRecord`, `StoreFile`, etc.) can stay
as plain Zod schemas for validation since they're only used internally for file parsing.
The public-facing `Info`, `Oauth`, `Api`, `WellKnown` types must match the existing Effect Schema
classes already on dev:

```typescript
// These already exist on dev as Effect Schema classes — keep them unchanged:
export class Oauth extends Schema.Class<Oauth>("OAuth")({...}) {}
export class Api extends Schema.Class<Api>("ApiAuth")({...}) {}
export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({...}) {}
export const Info = Schema.Union([Oauth, Api, WellKnown])
```

The internal store validation (StoreFile, OAuthRecord, etc.) can use `z` from `zod` for file
parsing only — it's not exposed via the API layer.

## Implementation Steps

### Step 1.1 — Rewrite `auth/index.ts`

- [ ] Keep existing Effect Schema class definitions (`Oauth`, `Api`, `WellKnown`, `Info`, `AuthError`, `Interface`, `Service`) unchanged
- [ ] Add `OAUTH_DUMMY_KEY` export
- [ ] Add all internal Zod types for store file parsing (copy verbatim from feature branch):
  - `Health`, `OAuthRecord`, `OAuthProvider`, `ApiProvider`, `WellKnownProvider`, `ProviderEntry`, `StoreFile`
- [ ] Add `OAuthRecordMeta` type export
- [ ] Add file lock constants and `StoreLockTimeoutError`
- [ ] Add helper functions: `toMeta`, `ensureDataDir`, `withStoreLock`, `writeStoreFile`, `readStoreFile` (with legacy migration), `loadStoreFile`, `updateStoreWithLock`, `updateStore`, `updateStoreBestEffort`
- [ ] Add pure helpers: `ensureOAuthProvider`, `findOAuthRecord`, `normalizeOrder`, `recordIDsForNamespace`, `findOAuthRecordIDByRefreshToken`
- [ ] Rewrite `get(providerID)` as plain async (used by Service wrapper below)
- [ ] Rewrite `all()` as plain async
- [ ] Rewrite `set(key, info)` as plain async
- [ ] Rewrite `remove(key)` as plain async
- [ ] Add `addOAuth(providerID, input)` plain async export
- [ ] Add `Auth.OAuthPool` namespace with all methods (copy from feature branch verbatim)
- [ ] Update `Auth.Service` interface wrapper to call the plain async functions via `Effect.tryPromise`

**Service wrapper pattern:**
```typescript
// In the live layer implementation:
export const make = (): Interface => ({
  get: (providerID) => Effect.tryPromise({ try: () => get(providerID), catch: fail("get failed") }),
  all: () => Effect.tryPromise({ try: () => all(), catch: fail("all failed") }),
  set: (key, info) => Effect.tryPromise({ try: () => set(key, info), catch: fail("set failed") }),
  remove: (key) => Effect.tryPromise({ try: () => remove(key), catch: fail("remove failed") }),
})
```

**File size note:** `auth/index.ts` will be ~800 lines. Consider splitting at the `OAuthPool` namespace
boundary: `auth/oauth-pool.ts` for the OAuthPool namespace, keeping `auth/index.ts` under 300 lines.

### Step 1.2 — Create `auth/context.ts`

- [ ] Copy verbatim from feature branch (22 lines, no Zod dependency)
- Exports: `getOAuthRecordID(providerID)`, `withOAuthRecord(providerID, recordID, fn)`

### Step 1.3 — Create `auth/credential-manager.ts`

- [ ] Copy from feature branch with one adaptation: `BusEvent.define` may have different import path on dev
- [ ] Verify `Bus` import path (`"../bus"` — check dev branch has same path)
- [ ] Verify `TuiEvent` import path (`"../cli/cmd/tui/event"`)
- Exports: `CredentialManager.Event.Failover`, `CredentialManager.notifyFailover(input)`

### Step 1.4 — Create `auth/rotating-fetch.ts`

- [ ] Copy verbatim from feature branch (440 lines)
- [ ] Split into two files if >200 lines: `auth/rotating-fetch-helpers.ts` (pure helper functions) + `auth/rotating-fetch.ts` (main `createOAuthRotatingFetch` export)
- [ ] Verify imports: `Auth` from `./index`, `withOAuthRecord` from `./context`, `CredentialManager` from `./credential-manager`, `Log` from `../util/log`

### Step 1.5 — Create `auth/browser.ts`

- [ ] Copy verbatim from feature branch (829 lines)
- [ ] Split: `auth/browser-puppeteer-install.ts` (installPuppeteer, getPuppeteer, ensurePuppeteer, launchBrowserWithTimeout, killExistingBrowser) + `auth/browser.ts` (AuthBrowser namespace)
- [ ] Verify `Global.Path.data` import (`../global` — same on dev)
- [ ] Verify `@openauthjs/openauth/pkce` dependency exists in dev's `package.json`

## File Modularization Plan

Since auth/index.ts will exceed 200 lines:

```
auth/
├── index.ts              — public exports + Service wrapper (~150 lines)
├── auth-store.ts         — store file I/O, lock, read/write helpers (~200 lines)
├── auth-store-helpers.ts — pure helpers (ensureOAuthProvider, findOAuthRecord, etc.) (~80 lines)
├── oauth-pool.ts         — Auth.OAuthPool namespace (~250 lines)
├── context.ts            — AsyncLocalStorage (~22 lines)
├── credential-manager.ts — Bus events + TUI toasts (~62 lines)
├── rotating-fetch-helpers.ts — pure functions (isNetworkError, etc.) (~100 lines)
├── rotating-fetch.ts     — createOAuthRotatingFetch (~200 lines)
├── browser-puppeteer-install.ts — puppeteer install/launch helpers (~165 lines)
└── browser.ts            — AuthBrowser namespace (~400 lines)
```

## Todo Checklist

- [ ] 1.1 Rewrite `auth/index.ts` with store logic + Effect Service wrapper
- [ ] 1.1a Extract store I/O to `auth/auth-store.ts` if over 200 lines
- [ ] 1.1b Extract OAuthPool to `auth/oauth-pool.ts`
- [ ] 1.2 Create `auth/context.ts`
- [ ] 1.3 Create `auth/credential-manager.ts`
- [ ] 1.4 Create `auth/rotating-fetch.ts` (split helpers if needed)
- [ ] 1.5 Create `auth/browser.ts` (split puppeteer helpers if needed)
- [ ] Verify all imports compile (`bun tsc --noEmit` in opencode package)
- [ ] Ensure existing Effect Service callers on dev still work (search for `Auth.Service` usages)

## Success Criteria

- `Auth.Service.get/all/set/remove` work as Effects (existing callers unchanged)
- `Auth.OAuthPool.*` all work as plain async functions
- `Auth.addOAuth` works as plain async
- `AuthBrowser.*` works (puppeteer auto-install on first use)
- `CredentialManager.notifyFailover` publishes Bus event + TUI toast
- `createOAuthRotatingFetch` wraps fetch with rotation/health tracking

## Risk Assessment

- **Import path differences**: dev uses `@/` path aliases — verify all imports use correct aliases
- **Effect Schema vs Zod**: internal store schemas stay Zod (parsing only), public types stay Effect Schema
- **`@openauthjs/openauth/pkce`**: must be in dev's package.json; add if missing
- **`zod` dependency**: feature branch uses Zod internally — must be in dev's package.json
