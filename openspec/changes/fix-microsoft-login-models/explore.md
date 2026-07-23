# Exploration: Microsoft SSO login wipes all models from the UI

## Current State

The opencode fork ships with a forced Microsoft Entra ID login gate (`packages/opencode/src/cli/login-gate.ts` and the desktop twin in `packages/desktop/src/main/login-gate.ts`). The CLI gate is invoked at the top of `runInteractiveRuntime` (`packages/opencode/src/cli/cmd/run/runtime.ts:185`) and at the top of `run.ts:260`. The desktop gate runs before `createMainWindow()` (`packages/desktop/src/main/index.ts:351`).

Three login paths exist, all converging on the same `Auth.Service.set("microsoft", ...)` write to `~/.local/share/opencode/auth.json`:

| Path | Where | Outcome |
|------|-------|---------|
| `MICROSOFT_LOGIN_BYPASS=1` env | `login-gate.ts:44-46` | Returns immediately, **no auth write** |
| Admin username/password (`admin` / `opencode-admin` by default) | `login-gate.ts:48-74` | Returns true, **no auth write** |
| Microsoft OAuth (PKCE or Device Code) | `login-gate.ts:107-133` | Stores `Oauth { access, refresh, expires, accountId? }` under key `"microsoft"` |

The "static user (non-SSO)" in the bug report is a user who hits the admin-bypass branch (or sets `MICROSOFT_LOGIN_BYPASS=1`) — they reach the runtime with **no `microsoft` entry** in `auth.json`. The SSO user reaches the runtime with a `microsoft: Oauth` entry and **no other auth entries** (login-gate never writes anything else).

## Affected Areas

| File | Why it matters |
|------|----------------|
| `packages/opencode/src/provider/provider.ts:1302-1634` | Initializes the local `providers` state; decides which providers end up "connected" |
| `packages/opencode/src/provider/provider.ts:1340-1351` (`mergeProvider`) | Silently no-ops when `database[providerID]` is undefined |
| `packages/opencode/src/provider/provider.ts:1501-1533` | Auth loop and plugin auth loader loop — only paths that add non-API providers |
| `packages/opencode/src/provider/provider.ts:1535-1551` | `custom(dep)` loop — no entry for `microsoft` |
| `packages/opencode/src/plugin/microsoft.ts:639-722` | MS plugin: provides only `loader` (`apiKey` + `fetch`), **no `models` model list** |
| `packages/opencode/src/plugin/index.ts:66-84` | Registers `MicrosoftAuthPlugin` alongside xai, codex, copilot, etc. |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:34-59` | `GET /provider` endpoint — the source of the `connected: []` list the UI reads |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:24-30` | `GET /config/providers` endpoint — same `provider.list()` |
| `packages/app/src/hooks/use-providers.ts:50-58` | UI: `connected()` is what renders the model list in the prompt input |
| `packages/app/src/context/models.tsx:40-47` | `available` is built from `providers.connected()` — if it's empty, no models render |
| `packages/core/src/models-dev.ts` (upstream `https://models.dev/api.json`) | The `database` catalog; **does NOT include a `microsoft` provider** |
| `packages/schema/src/provider.ts:21` | `ProviderV2.ID` statics include `microsoft: schema.make("microsoft")` |
| `packages/opencode/src/auth/index.ts:18-28` | `Oauth` schema (only stores token data, no model list) |
| `packages/opencode/src/cli/login-gate.ts:85-105` | `storeMicrosoftTokens` writes the OAuth entry that triggers the bug |

## Auth Flow (Microsoft SSO → runtime)

```
enforceMicrosoftLogin()  [cli/login-gate.ts]
   ├─ isBypassEnabled() / checkAdminBypass()  →  return early  (no auth write)
   ├─ hasMicrosoftAuth()  →  return early  (already authed)
   └─ runMicrosoftOAuth()
        ├─ startOAuthServer()       (HTTP server on 127.0.0.1:53800)
        ├─ buildAuthorizeUrl()      (PKCE, state, scopes = openid email profile offline_access)
        ├─ open browser / device code
        ├─ waitForOAuthCallback()   (5-minute timeout, CSRF state check)
        └─ storeMicrosoftTokens()   (Auth.Service.set("microsoft", Oauth))
                                          ↓
                                auth.json: { "microsoft": { type:"oauth",
                                                            access, refresh, expires,
                                                            accountId (oid|sub) } }
```

The `desktop/src/main/login-gate.ts` twin re-implements the PKCE flow inline and POSTs the same `Oauth` shape to `PUT /auth/microsoft` on the sidecar (`packages/opencode/src/server/routes/instance/httpapi/groups/control.ts:31-50`).

## Model Resolution Flow

The local `Provider` service builds the model list at `provider.ts:1302-1634` inside `InstanceState.make`. Sequence of merges into the local `providers` state (each merge keys off the models.dev `database`):

1. **Plugin `models` hook** (line 1367-1392) — per-plugin callable. None of the registered internal plugins (`xai`, `codex`, `copilot`, `microsoft`, `cloudflare-ai-gateway`, `azure`, `digitalocean`, `snowflake-cortex`, `poe`, `gitlab`) defines a `models` hook. **No contribution.**
2. **Config providers** (line 1394-1486) — only fires when `cfg.provider[providerID]` exists. For MS-SSO users with no `opencode.json` overrides, **no contribution**.
3. **Env vars** (line 1488-1499) — `provider.env.map(e => envs[e]).find(Boolean)`. For MS-SSO users with no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` etc., **no contribution**.
4. **API-key auth** (line 1501-1512) — iterates `auth.all()`, **skips `oauth` type** (`if (provider.type === "api")`). The MS-SSO `microsoft` entry is OAuth, **so it is ignored here**.
5. **Plugin auth loader** (line 1514-1533) — for every plugin with `auth.provider`, if a stored `auth.get()` exists and the plugin has a `loader`, calls `loader(...)` and merges the returned options. **This is the only route that can register the `microsoft` provider.** The MS plugin's loader (`microsoft.ts:648-722`) returns `{ apiKey: OAUTH_DUMMY_KEY, fetch: ... }`. The `mergeProvider("microsoft", { source: "custom", options: opts })` is then called.
6. **`custom(dep)`** (line 1535-1551) — runs custom provider logic. **No `microsoft` key exists in this map.**

`mergeProvider` (line 1340-1351):

```ts
function mergeProvider(providerID, provider) {
  const existing = providers[providerID]
  if (existing) { providers[providerID] = mergeDeep(existing, provider); return }
  const match = database[providerID]
  if (!match) return                                  // <-- silent bail
  providers[providerID] = mergeDeep(match, provider)
}
```

`database` is `mapValues(modelsDev, fromModelsDevProvider)` (line 1318), where `modelsDev` is the upstream `https://models.dev/api.json` snapshot. I verified against the live API: **the `microsoft` key is not present.** Closest entries are `azure` (109 models) and `azure-cognitive-services` (3 models). Therefore `database["microsoft"]` is `undefined`, and the plugin auth loader's `mergeProvider` call at step 5 silently bails.

Result: the local `providers` state for an MS-SSO user is `{}` (no API keys, no env vars, no models.dev hit, no working merge). `Provider.list()` returns an empty record.

The HTTP endpoint `GET /provider` (`handlers/provider.ts:40-59`) returns:

```ts
{
  all:      [...models.dev catalog mapped via fromModelsDevProvider],  // has azure, anthropic, ...
  default:  { [providerID]: defaultModelID },                          // computed from providers record
  connected: Object.keys(connected),                                   // []  ← empty for MS-SSO user
}
```

The UI then filters via `useProviders().connected()` → `selectProviderCatalog` → `Iterable.filter((p) => connected.has(p.id))`. With `connected: []`, the UI sees no providers. `ModelsProvider.list()` (`app/src/context/models.tsx:96`) builds `available` from `providers.connected()` — empty — and the prompt input shows zero models.

The static (admin-bypass) user has the same empty local `providers` state **unless** they have env vars (e.g. `ANTHROPIC_API_KEY`) or pre-existing API-key entries in `auth.json` (e.g. from `opencode auth login`). When they do, the `env` loop (step 3) or the `api` auth loop (step 4) populates the local state with `anthropic` / `openai` / etc. and the UI shows those models. That is why the bug only fires for the MS-SSO user — the static user has *something else* filling the catalog; the MS user has nothing.

## Approaches

1. **Add a `microsoft` provider entry to models.dev upstream**
   - Pros: clean, fits the existing data flow
   - Cons: we don't own `models.dev`; cannot ship a fix in this fork without either forking the catalog or maintaining a local override file. Microsoft doesn't expose a public OpenAI-compatible API the way Azure does, so there is no obvious model list to register
   - Effort: High (requires either an external contribution to models.dev, or a new `OPENCODE_MODELS_PATH` override file shipped with the fork)

2. **Add a `custom("microsoft", ...)` in `custom(dep)` that seeds a minimal catalog entry**
   - Pros: local to the fork, uses the existing extension hook, allows the plugin auth loader to successfully merge the provider
   - Cons: the catalog entry has no real `models`; the UI will show the provider but no models to pick — better than today but still incomplete. The loader's `OAUTH_DUMMY_KEY` won't actually call any model API
   - Effort: Low (≈20 lines, single file change in `provider.ts`)

3. **Change `mergeProvider` to allow plugin-defined providers without a models.dev entry**
   - Pros: minimal change, makes the plugin auth loader the source of truth for plugin-only providers. Frees plugin authors from needing a models.dev entry
   - Cons: still needs the plugin to register *some* model list (or the provider shows up with zero models). May have knock-on effects for `getLanguage` which expects `model.api.npm`
   - Effort: Low-Medium (modify `mergeProvider` + ensure `database` lookup at `toPublicInfo` in the plugin auth loader call (line 1527) doesn't break when `database["microsoft"]` is undefined — it currently passes `undefined` into `toPublicInfo` and the loader ignores it, so this is already safe)

4. **Have the Microsoft plugin itself declare a static model list via a `models` hook**
   - Pros: matches what other plugins could do; surfaces real Microsoft models (e.g. those reachable via `https://models.github.ai/inference` or Azure-hosted OpenAI deployments)
   - Cons: requires choosing a target endpoint + model list. Microsoft offers multiple model surfaces (GitHub Models inference, Azure AI Studio, Azure OpenAI) — they each need a different `api.npm` and `baseURL`. This is a design question, not a code one
   - Effort: Medium (requires deciding what "Microsoft models" means for the user, then wiring a `models` hook in `microsoft.ts`)

5. **Treat the bug as "stop blocking the model list when only OAuth is present"**
   - Pros: restores the old behavior (static user still sees their env-var-driven providers)
   - Cons: requires either running the login-gate in bypass mode by default for the MS-SSO user, or running the env-var scan after the gate. The auth still wouldn't unlock any Microsoft-specific models — the user would just see whatever their env vars provide. Effectively reverts the SSO gate to a no-op for model visibility
   - Effort: Low but architecturally wrong (defeats the purpose of the gate)

## Recommendation

**Approach 3 + Approach 4 together**, in that order:

- **Phase 1 (Approach 3)**: relax `mergeProvider` (and the downstream call at `provider.ts:1527` that already passes `undefined` safely) so a plugin's auth loader can register a provider that doesn't exist in models.dev. This unblocks MS-SSO users from "no providers at all" to "the provider is visible, with whatever models the plugin declares."
- **Phase 2 (Approach 4)**: pick a concrete Microsoft model surface (likely GitHub Models inference at `https://models.github.ai/inference` with the `@ai-sdk/openai-compatible` SDK, since the MS OAuth token works there) and have the MS plugin declare that model list via a `models` hook. The MS plugin becomes a first-class provider with real model entries.

If scope must be tight, **ship Phase 1 only** as a minimal "fix" that lets the MS-SSO user at least see *some* providers (the same env-var-driven ones the static user sees, plus the `microsoft` provider stub). Document Phase 2 as follow-up.

Avoid Approach 1 (out of our control), Approach 2 (no real models), and Approach 5 (architecturally wrong).

## Risks

- **The MS OAuth token alone is not enough to call any model API.** The `OAUTH_DUMMY_KEY` returned by the loader is a placeholder; the real `access_token` is only used to attach a `Bearer` header to outbound requests. Without a defined `baseURL` and a known model surface, those requests will 401. Phase 1 alone shows the provider in the UI but will not successfully serve a prompt.
- **Upstream `models.dev` snapshot is the source of truth for the `database`.** If a future version of `models.dev` adds a `microsoft` entry, the existing `mergeProvider` behavior would start working for MS-SSO users — Phase 1 should be a no-op in that case (the new `mergeProvider` must still match the existing match-against-database path).
- **The desktop `login-gate.ts` duplicates the flow inline.** It calls `PUT /auth/microsoft` on the sidecar, not `Auth.Service.set` directly, but the storage is the same file. The fix in `provider.ts` covers both CLI and desktop paths.
- **The `login-gate.ts:107-133` `runMicrosoftOAuth` doesn't surface the OAuth scopes to the provider.** The `Oauth` schema (`auth/index.ts:18-28`) now has optional `email`, `displayName`, `tenantId` fields but the MS plugin doesn't populate them. Any future per-tenant model gating would have to read those from the stored `Oauth`.
- **`Provider.list()` is cached at the `InstanceState` level** (`provider.ts:1637`). After `enforceMicrosoftLogin` writes `auth.json`, the `Provider` service instance is created lazily. The first `sdk.provider.list()` call from the UI materializes the state. If the user is mid-session and the auth file is updated externally, the state is stale. Today this is fine because the gate runs before the server starts serving the UI.
- **No existing test** for "MS-SSO login + provider list". The `test/tool/fixtures/models-api.json` fixture has `microsoft/wizardlm-2-8x22b` etc. as sub-models of `openrouter`, not as a top-level `microsoft` provider. A regression test for this bug needs a new fixture that includes (or excludes) a `microsoft` provider entry.

## Ready for Proposal

Yes. Suggested scope for the next phase (`sdd-propose`):

- **Title**: `fix-microsoft-login-models`
- **Intent**: ensure that a user authenticated via Microsoft Entra ID sees a usable model list in the opencode prompt input instead of an empty UI.
- **Approach**: Phase 1 (relax `mergeProvider` to accept plugin-defined providers without a models.dev entry) + Phase 2 (MS plugin declares a GitHub Models model list via a `models` hook, with `api.npm = "@ai-sdk/openai-compatible"` and `baseURL = "https://models.github.ai/inference"`).
- **Out of scope for Phase 1**: any model list wiring; just make `microsoft` register as a provider when the OAuth entry exists. Phase 1 alone is the minimum to restore the UI.
- **In scope for Phase 2**: choosing the model surface (GitHub Models vs. Azure OpenAI vs. MAI), wiring the SDK, and updating the existing `microsoft-auth` spec at `openspec/changes/microsoft-auth/specs/auth-architecture-baseline/spec.md` with a new MODIFIED requirement for "Microsoft provider model registration."

Concrete code anchors to revisit during proposal:

- `provider.ts:1340-1351` — `mergeProvider`
- `provider.ts:1501-1533` — auth loop + plugin auth loader
- `provider.ts:1527` — `toPublicInfo(database[plugin.auth!.provider])` call site; currently `undefined` for microsoft, must remain safe
- `microsoft.ts:639-805` — `MicrosoftAuthPlugin`; add a `models` hook here for Phase 2
- `providers.ts:212-237` — `resolvePluginProviders`; already correctly surfaces plugin providers that aren't in models.dev — no change needed
- `handlers/provider.ts:40-59` — endpoint; no change needed
- `use-providers.ts:50-58` and `models.tsx:40-47` — UI; no change needed (they will Just Work once `connected` is non-empty)
