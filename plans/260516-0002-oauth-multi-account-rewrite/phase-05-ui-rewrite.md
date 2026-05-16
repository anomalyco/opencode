# Phase 05 — UI Rewrite (settings-providers.tsx)

**Priority:** Medium
**Status:** DONE
**Depends on:** Phase 02 (server routes must exist for API calls), Phase 06 partial (SDK types helpful but not required — can use raw fetch)

## Context Links

- Source: `packages/app/src/components/settings-providers.tsx` (feature branch, 960 lines)
- Target: `packages/app/src/components/settings-providers.tsx` (dev, 251 lines)
- Dev SDK client: `useGlobalSDK()` → `globalSDK.client.auth.*` and `globalSDK.client.provider.*`
- Dev dialog components: `DialogConnectProvider`, `DialogCustomProvider`, `DialogSelectProvider`
- Dev hooks: `useProviders()`, `useGlobalSync()`, `useLanguage()`, `usePlatform()`

## Overview

Dev's `settings-providers.tsx` is a simple 251-line list of connected providers with connect/disconnect.
The feature branch version (960 lines) adds:

1. **ProviderDetailView** — drill-down from provider list into per-provider account management
2. **AccountList** — health indicators, active badge, switch, rename (inline edit), delete
3. **AnthropicUsageBars** — 5h/7d/7d-sonnet utilization bars
4. **AutoReloginSection** — browser session management per account (Anthropic only)
5. **AddAccountButton** — triggers `DialogConnectProvider` for the specific provider
6. **Multi-account info banner** — shown in list view

The feature branch UI is complete and in SolidJS — it can be ported almost verbatim.
The main adaptation is aligning API call URLs and SDK client method names.

## Key Differences to Resolve

### API URL Differences

Feature branch calls bare paths directly via `doFetch`:

| Feature branch URL | Dev equivalent |
|--------------------|----------------|
| `${globalSDK.url}/auth/active` | POST to `/provider/auth/active` |
| `${globalSDK.url}/auth/account` DELETE | DELETE `/provider/auth/account` |
| `${globalSDK.url}/provider/auth/account` PATCH | PATCH `/provider/auth/account` |
| `${globalSDK.url}/provider/auth/browser-session` | GET `/provider/auth/browser-session` |
| `${globalSDK.url}/provider/auth/browser-session/:id/*` | same pattern |

**Note:** After Phase 02 routes land, all paths are under `/provider/auth/...`.
The feature branch has some URLs at `/auth/...` (without `/provider` prefix) — these must
be updated to match the Effect HttpApi paths defined in Phase 02.

### SDK Client vs Raw Fetch

Feature branch mixes `globalSDK.client.auth.usage({})` (SDK call) with raw `doFetch(url)` calls.
On dev, after SDK regen (Phase 06), proper SDK methods will exist. During Phase 05 (before SDK
regen), use raw fetch for the new endpoints and SDK client for existing ones:

```typescript
// Existing SDK call (keep):
const result = await globalSDK.client.auth.usage({})

// New endpoints — use raw fetch until SDK is regenerated:
const platform = usePlatform()
const doFetch = platform.fetch ?? fetch
await doFetch(`${globalSDK.url}/provider/auth/account`, {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ providerID, recordID }),
})
```

After Phase 06 (SDK regen), replace raw fetch calls with proper SDK calls.

### Dev Dialog Components

Feature branch uses `DialogConnectProvider` — same component exists on dev. Keep the same call:
```typescript
dialog.show(() => <DialogConnectProvider provider={props.providerID} />)
```

## File Size / Modularization

960 lines exceeds the 200-line guideline. Split:

```
components/
├── settings-providers.tsx            — SettingsProviders component + list view (~150 lines)
├── settings-providers-detail.tsx     — ProviderDetailView component (~300 lines)
├── settings-providers-account.tsx    — AccountRow component (rename/delete/switch/health) (~200 lines)
├── settings-providers-browser.tsx    — AutoReloginSection + BrowserSessionRow (~150 lines)
└── settings-providers-usage-bar.tsx  — UsageBarPercent + formatting helpers (~60 lines)
```

## Implementation Steps

### Step 5.1 — Create `settings-providers-usage-bar.tsx`

Copy verbatim from feature branch:
- [ ] `formatResetTime(resetAt?)` helper
- [ ] `getColorClass(percent)` helper
- [ ] `UsageBarPercent` component
- [ ] Export all three

### Step 5.2 — Create `settings-providers-account.tsx`

Extract from feature branch `ProviderDetailView` the per-account row logic:
- [ ] `AccountUsage` interface
- [ ] `AccountRow` component props: `account, index, providerID, support, onSwitch, onDelete, onRename`
- [ ] Inline rename input state (or lift to parent via callbacks)
- [ ] Switch/delete/confirm-delete buttons
- [ ] Health badge (cooldown indicator)
- [ ] Active badge

### Step 5.3 — Create `settings-providers-browser.tsx`

Extract browser session section from feature branch `ProviderDetailView`:
- [ ] `BrowserSessionStatus` interface
- [ ] `AutoReloginSection` component props: `accounts, providerURL, onRefetch`
- [ ] Internal state: `browserSessions`, `settingUpBrowser`, `refreshingBrowser`, `rebindingBrowser`, `removingBrowser`
- [ ] `loadBrowserSessions`, `setupBrowserSession`, `refreshBrowserSession`, `rebindBrowserSession`, `removeBrowserSession` functions

### Step 5.4 — Create `settings-providers-detail.tsx`

The `ProviderDetailView` using the sub-components above:
- [ ] Import `AccountRow`, `AutoReloginSection`, `UsageBarPercent`
- [ ] Props: `{ providerID, providerName, onBack }`
- [ ] `[usage, { refetch, mutate }]` resource for `globalSDK.client.auth.usage({})` filtered to this provider
- [ ] `switchAccount`, `deleteAccount` using raw fetch (until SDK regen)
- [ ] Anthropic usage bars section (conditional on `providerID === "anthropic"`)
- [ ] "Add Account" button → `DialogConnectProvider`
- [ ] `OAUTH_MULTI_ACCOUNT_SUPPORT` map (copy verbatim from feature branch)

### Step 5.5 — Rewrite `settings-providers.tsx`

Replace dev's 251-line file:
- [ ] Keep all existing imports that are still needed (`useProviders`, `useDialog`, etc.)
- [ ] Add `ProviderDetailView` import from `./settings-providers-detail`
- [ ] Add `view` signal: `"list" | "add" | { detail: string }`
- [ ] Keep the connected provider list
- [ ] Make each connected provider row clickable → `setView({ detail: provider.id })`
- [ ] Show `ProviderDetailView` when `view()` is `{ detail: id }`
- [ ] Add provider list view with search (for "add provider" view)
- [ ] Add "Add Provider" button → `setView("add")`
- [ ] Add multi-account info banner
- [ ] Keep custom provider section (already on dev)
- [ ] Keep `disconnect` function (already on dev, uses `globalSDK.client.auth.remove`)

### Step 5.6 — Type alignment

The `AuthUsageData` shape from the server must match what the component expects.
Copy the interface definitions from the feature branch:
```typescript
interface AccountUsage { id, label?, isActive?, health: {...} }
interface AnthropicUsage { fiveHour?, sevenDay?, sevenDaySonnet? }
interface ProviderUsage { accounts: AccountUsage[], anthropicUsage?: AnthropicUsage }
type AuthUsageData = Record<string, ProviderUsage>
```

## Todo Checklist

- [ ] 5.1 Create `settings-providers-usage-bar.tsx`
- [ ] 5.2 Create `settings-providers-account.tsx`
- [ ] 5.3 Create `settings-providers-browser.tsx`
- [ ] 5.4 Create `settings-providers-detail.tsx`
- [ ] 5.5 Rewrite `settings-providers.tsx` (list + routing to detail view)
- [ ] 5.6 Fix all API call URLs to match Phase 02 route paths
- [ ] 5.7 Verify `OAUTH_MULTI_ACCOUNT_SUPPORT` map is current
- [ ] Compile check: `tsc --noEmit` in app package
- [ ] Visual check: open Settings → Providers, click a connected OAuth provider
- [ ] Verify: account list renders, switch/delete/rename works

## Success Criteria

- Provider list shows "Multi-account" badge for supported providers
- Clicking a connected provider opens `ProviderDetailView`
- Account list shows health indicators (cooldown, success count)
- Active account has green "Active" badge
- Switching accounts calls `/provider/auth/active` and updates UI optimistically
- Deleting last account navigates back to list
- Renaming shows inline input, saves on Enter/Save click
- Anthropic shows rate limit bars when usage data available
- Auto-Relogin section visible for Anthropic accounts
- Browser setup/refresh/rebind/remove buttons functional

## Risk Assessment

- **`globalSDK.client.auth.usage` shape**: dev SDK may not yet have this method; use raw fetch fallback: `doFetch(\`${globalSDK.url}/provider/auth/usage\`)`
- **`usePlatform().fetch`**: dev may expose platform fetch differently — fallback `fetch` is always safe
- **SolidJS reactivity**: `createResource` with manual `mutate` for optimistic updates is already in feature branch — copy verbatim
- **`formatTimeAgo` takes string**: feature branch passes `session.lastRefresh` (a number timestamp) but formats it as if it's a string date — verify type alignment with `BrowserSessionStatus.lastRefresh?: number`
