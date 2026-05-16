# Phase 06 — SDK Regen + Tests

**Priority:** Low (cleanup, but needed before merge)
**Status:** DONE*
**Depends on:** Phase 01, 02 (all schemas and routes must be finalized)

## Context Links

- SDK gen script: search `packages/sdk/` for a `generate` or `gen` script
- Generated output: `packages/sdk/js/src/v2/gen/` (auto-generated, do not hand-edit)
- Existing auth tests: `packages/opencode/test/auth/auth.test.ts`
- Feature branch tests: same path — check for additions

## Part A — SDK Regeneration

### Step 6.1 — Find the gen script

- [ ] Check `packages/sdk/package.json` for `generate` or `gen` script
- [ ] Check repo root `package.json` scripts
- [ ] Check for a `scripts/` directory with a codegen script
- [ ] Common pattern: `bun run generate` in `packages/sdk/`

### Step 6.2 — Run SDK generation

```bash
# From repo root or packages/sdk:
bun run generate
# OR
bun run gen
```

- [ ] Ensure the server is not running (gen script may start its own instance)
- [ ] If the script requires a running server, start it first: `bun run dev` in `packages/opencode`
- [ ] Verify generated files update in `packages/sdk/js/src/v2/gen/`

### Step 6.3 — Verify new SDK methods appear

After regeneration, the following should exist in the generated client:

```typescript
// Expected new methods on the auth group:
client.auth.removeAccount({ providerID, recordID })       // DELETE /provider/auth/account
client.auth.setActive({ providerID, recordID, namespace }) // POST /provider/auth/active
client.auth.updateAccount({ providerID, recordID, label }) // PATCH /provider/auth/account
client.auth.usage({})                                       // GET /provider/auth/usage

// Expected new methods on the provider group:
client.provider.browserSessions()                           // GET /provider/auth/browser-session
client.provider.browserSession({ recordId })                // GET /provider/auth/browser-session/:recordId
client.provider.setupBrowserSession({ recordId })           // POST /provider/auth/browser-session/:recordId/setup
client.provider.refreshBrowserSession({ recordId })         // POST /provider/auth/browser-session/:recordId/refresh
client.provider.removeBrowserSession({ recordId })          // DELETE /provider/auth/browser-session/:recordId
```

- [ ] Check that all 9 new methods are present
- [ ] Check response types match the Schema definitions from Phase 02

### Step 6.4 — Update UI to use SDK methods (post-regen)

After SDK regen, replace raw `doFetch` calls in Phase 05 UI with proper SDK calls:

```typescript
// Replace raw fetch:
await doFetch(`${globalSDK.url}/provider/auth/account`, { method: "DELETE", body: ... })
// With SDK call:
await globalSDK.client.auth.removeAccount({ providerID, recordID })
```

- [ ] Update `settings-providers-detail.tsx` → `switchAccount` uses `client.auth.setActive`
- [ ] Update `settings-providers-detail.tsx` → `deleteAccount` uses `client.auth.removeAccount`
- [ ] Update `settings-providers-account.tsx` → rename uses `client.auth.updateAccount`
- [ ] Update `settings-providers-browser.tsx` → browser calls use `client.provider.*BrowserSession*`

## Part B — Test Updates

### Step 6.5 — Check existing auth tests

- [ ] Read `packages/opencode/test/auth/auth.test.ts`
- [ ] Identify tests that test `Auth.get`, `Auth.set`, `Auth.remove`, `Auth.all`
- [ ] Verify they still pass after the Phase 01 rewrite

### Step 6.6 — Add missing tests for new Auth functions

The feature branch `auth.test.ts` should have tests for the new functions. Port any new tests:

Key test scenarios to cover if not already present:

```typescript
// Auth store multi-account
describe("Auth.addOAuth", () => {
  it("creates first account with label 'default'")
  it("creates second account with label 'Account 2'")
  it("updates existing account when refresh token matches")
  it("normalizes trailing slashes in providerID")
})

describe("Auth.OAuthPool", () => {
  it("list() returns accounts for namespace")
  it("orderedIDs() respects order array")
  it("moveToBack() moves record to end and updates active")
  it("recordOutcome() sets cooldownUntil on failure")
  it("recordOutcome() clears cooldown on success")
  it("markAccessExpired() clears access token and expires")
  it("setActive() reorders and sets active")
  it("updateRecord() patches label")
  it("removeRecord() removes record and cleans up order/active")
  it("removeRecord() deletes provider entry when last record removed")
})

describe("Auth store migration", () => {
  it("migrates v1 flat format to v2 multi-account format")
  it("preserves api-type credentials during migration")
  it("preserves wellknown-type credentials during migration")
})
```

### Step 6.7 — Add Auth.Service Effect layer tests

The `Auth.Service` wrapper (Phase 01) needs Effect-layer tests:

```typescript
it("Auth.Service.get wraps plain async get in Effect")
it("Auth.Service.set wraps plain async set in Effect")
it("Auth.Service.all wraps plain async all in Effect")
it("Auth.Service.remove wraps plain async remove in Effect")
```

### Step 6.8 — Verify existing test suite passes

```bash
cd packages/opencode
bun test
```

- [ ] All existing tests pass
- [ ] New tests pass
- [ ] No regressions in `test/provider/` tests (rotating-fetch integration)

## Todo Checklist

- [ ] 6.1 Find SDK gen script location
- [ ] 6.2 Run SDK regeneration
- [ ] 6.3 Verify all 9 new SDK methods present
- [ ] 6.4 Update UI raw fetch calls to use generated SDK methods
- [ ] 6.5 Read existing auth tests, verify they still pass
- [ ] 6.6 Add `Auth.addOAuth` and `Auth.OAuthPool` tests
- [ ] 6.7 Add `Auth.Service` Effect layer wrapper tests
- [ ] 6.8 Run full test suite, fix any failures
- [ ] Final compile check across all packages: `bun tsc --noEmit`

## Success Criteria

- SDK gen produces all 9 new methods with correct TypeScript types
- UI uses SDK methods (not raw fetch) for all new endpoints
- All auth tests pass (existing + new)
- No regressions in any existing test suite
- `bun tsc --noEmit` passes in `packages/opencode`, `packages/app`, `packages/sdk`

## Risk Assessment

- **SDK gen script unknown**: if no gen script exists, check repo CI (`generate.yml` workflow on dev) — it may run `openapi-typescript` or a custom codegen
- **Test file conflicts**: feature branch test additions may conflict with dev's test structure if dev changed test helpers — adapt imports and test scaffolding as needed
- **Effect layer test setup**: `Auth.Service` is a `Context.Service` — tests need to provide a live layer; check existing dev tests for the `Effect.runPromise` / `Layer.provide` pattern used
- **SDK method naming**: generated names depend on `identifier` annotations in the group file (Phase 02) — verify identifiers are kebab-free and valid TypeScript identifiers (use dot notation: `"auth.removeAccount"` generates `removeAccount` on the `auth` namespace)
