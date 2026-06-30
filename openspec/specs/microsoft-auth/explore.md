# Exploration: Microsoft Entra ID / Microsoft Account OAuth2/OIDC Authentication

## Current State

OpenCode currently supports three authentication patterns across different plugins:

| Pattern | Provider | Implementation | Location |
|---------|----------|---------------|----------|
| Device Code Flow (RFC 8628) | GitHub Copilot | `copilot.ts` calls GitHub's device API, polls for token | `packages/opencode/src/plugin/github-copilot/copilot.ts` |
| Authorization Code + PKCE (browser) + Device Code (headless) | OpenAI Codex | Loopback server on port 1455 + custom device auth API | `packages/opencode/src/plugin/openai/codex.ts` |
| Authorization Code + PKCE (browser) + Device Code (headless) | xAI Grok | Loopback server on **port 56121** with CORS + RFC 8628 device code | `packages/opencode/src/plugin/xai.ts` |
| API Key only | Azure | No OAuth, reads `AZURE_RESOURCE_NAME` env var | `packages/opencode/src/plugin/azure.ts` |
| Web OAuth (@openauthjs/openauth) | Console (Cloudflare Workers) | Server-side OAuth with GitHub/Google providers, session storage in KV + Drizzle | `packages/console/function/src/auth.ts` |

**There is NO Microsoft/Entra ID provider plugin yet.** The auth baseline spec documents this gap at `openspec/specs/auth-architecture-baseline/spec.md`.

## Affected Areas

### New File
- `packages/opencode/src/plugin/microsoft.ts` — Auth plugin (follows xAI/Codex pattern)

### Modified Files
- `packages/opencode/src/plugin/index.ts` — Add `MicrosoftAuthPlugin` to `internalPlugins()` (lines 66–82)
- `packages/core/src/provider.ts` — Add `microsoft` to `ProviderV2.ID` well-known providers (lines 8–21)
- `packages/core/src/plugin/provider/microsoft.ts` — **(optional)** If the Microsoft auth is used for AI model consumption via Azure OpenAI Entra ID auth, a core V2 provider plugin may also be needed

### Files for Reference
- `packages/opencode/src/plugin/xai.ts` — Most relevant template to follow (most polished, most recent, CORS-aware)
- `packages/opencode/src/plugin/openai/codex.ts` — Original PKCE pattern that xAI extended
- `packages/opencode/src/provider/auth.ts` — ProviderAuth service that orchestrates auth hooks
- `packages/opencode/src/auth/index.ts` — Auth storage service (Oauth/Api schemas)
- `packages/plugin/src/index.ts` — AuthHook type definitions
- `packages/core/src/util/encode.ts` — Existing base64 encode/decode utilities

## Approaches

### 1. Authorization Code + PKCE with Loopback Server (Recommended — Default)

**Description**: Follow the xAI pattern exactly. Open a local HTTP server on `127.0.0.1`, generate PKCE challenge/verifier, redirect the user's browser to Microsoft's authorize endpoint, receive the authorization code on the loopback server, exchange it for tokens, and persist them.

**Microsoft v2.0 OAuth endpoints:**
- Authorize: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
- Token: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`

**Tenant options:**
- `common` — Multi-tenant (any Microsoft account, work/school/personal)
- `organizations` — Work/school accounts only (Entra ID)
- `consumers` — Personal Microsoft accounts only (MSA)
- `{tenant-id}` — Single tenant (for enterprise deployments)

**Scopes:** `openid email profile offline_access` (+ optionally `https://graph.microsoft.com/.default`)

**Client type:** Public client (CLI) = PKCE only, no client secret. A client app registration is needed in Azure AD.

**Key implementation details (from xAI template):**

```
microsoft.ts structure:
├── Constants: CLIENT_ID, endpoints, OAUTH_PORT, REDIRECT_URI
├── PKCE: generatePKCE(), base64UrlEncode(), generateState()
├── OAuth endpoints: buildAuthorizeUrl()
├── Token operations: exchangeCodeForTokens(), refreshAccessToken()
├── JWT helpers: parseJwtClaims(), extractAccountId() (from 'oid' claim)
├── HTML templates: HTML_SUCCESS, HTML_ERROR (dark theme matching opencode UI)
├── Server management: startOAuthServer(), stopOAuthServer()
├── Callback handling: waitForOAuthCallback() with 5min timeout
└── Plugin export: MicrosoftAuthPlugin → Hooks with auth.loader + methods[]
```

- **Pros**: Most natural UX for desktop users. Follows established codebase pattern. PKCE is required for Microsoft public clients (no client secret leak). Well-tested pattern shared by xAI and Codex.
- **Cons**: Requires a browser on the same machine (loopback `127.0.0.1`). Port conflicts possible (choose an uncommon port). Microsoft's consent screen shows "unverified app" for new registrations.
- **Effort**: Medium

### 2. Device Code Flow (RFC 8628) — Companion for Headless Environments

**Description**: Microsoft supports RFC 8628 device authorization grant. The CLI requests a device code from Microsoft, shows the user a URL + code to visit, and polls for the token until the user completes authorization in a browser on any device.

**Microsoft device authorization endpoint:**
- `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode`

- **Pros**: Works on any CLI environment (SSH, VPS, Docker, CI, WSL without browser). No loopback server needed. Follows the same dual-flow pattern as xAI (browser + headless).
- **Cons**: Microsoft supports this but it's less commonly used. Requires user to type a code manually. Polling loop consumes resources.
- **Effort**: Medium (add as second method alongside PKCE)

### 3. Confidential Client (Console Web Auth) — Not for CLI

**Description**: Uses `@openauthjs/openauth` with a client secret, similar to the console. Only applicable for web-based (confidential client) flow where the secret is stored server-side.

- **Pros**: Can use authorization code without PKCE (client secret proves identity). Supports refresh token rotation with secret.
- **Cons**: Requires a server-side client secret. Not suitable for a CLI / desktop app. Completely different architecture than existing CLI patterns.
- **Effort**: High (would need Console integration, not relevant for this fork)

### 4. Windows Native Auth Broker (WAM / MSAL) — Not Recommended

**Description**: Use MSAL (Microsoft Authentication Library) to integrate with Windows Authentication Broker for SSO.

- **Pros**: Best UX on Windows — no browser popup, uses Windows Hello / cached credentials. Supports WAM (Web Account Manager).
- **Cons**: Platform-specific (Windows only). Would need native bindings. Doesn't follow existing CLI OAuth patterns. Considerable complexity.
- **Effort**: Very High

## Recommendation

### Recommended Approach: Authorization Code + PKCE (browser) + Device Code (headless)

Follow the **xAI pattern precisely** — it is the most mature, most tested, and most recent implementation in this codebase. Implement both flows:

1. **Primary (desktop)**: Authorization Code + PKCE with local loopback server on `127.0.0.1:53800/callback` (or similar high port)
2. **Secondary (headless/VPS)**: Device Code flow (RFC 8628) for environments where a local browser isn't available

Both flows share the same token exchange, refresh, and storage logic — only the authorization method differs.

### Azure AD App Registration Requirements

A public client (mobile/desktop) app registration is required in Azure AD with:
- **Redirect URI**: `http://localhost:53800/callback` (must match exactly — Microsoft validates this; trailing slash matters)
- **Platform**: Mobile and desktop applications
- **Supported account types**: "Accounts in any organizational directory (Any Microsoft Entra ID tenant) and personal Microsoft accounts" (= multi-tenant)
- **Client ID**: Generated by Azure AD registration
- **Client secret**: NOT needed (public client, PKCE only)
- **API permissions**: `openid`, `email`, `profile`, `offline_access` (delegated)

### Client ID Strategy

For a fork, use a placeholder client ID that can be swapped later:
- Option A: Hardcode a registered client ID (if one is created for the fork)
- Option B: Make it configurable via environment variable (`MICROSOFT_CLIENT_ID`)
- Option C: Accept as plugin option (matching xAI's `XaiAuthPluginOptions` pattern)

**Recommendation**: Option C (plugin options) + fallback to env var — matching the pattern used by Azure plugin for `AZURE_RESOURCE_NAME`.

## Implementation Plan

### Step 1: Register Client ID Constants
```typescript
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "<placeholder>"
const TENANT = "common" // or configurable
const OAUTH_PORT = 53800
const OAUTH_HOST = "127.0.0.1"
const OAUTH_REDIRECT_PATH = "/callback"
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`
const SCOPE = "openid email profile offline_access"
```

### Step 2: Implement PKCE + Token Exchange
- `generatePKCE()` — verifier (43–128 chars, use 64 like xAI), challenge (S256)
- `exchangeCodeForTokens()` — POST to `/oauth2/v2.0/token`
- `refreshAccessToken()` — POST with `grant_type=refresh_token`
- `parseJwtClaims()` — Unsigned JWT decode (for `oid`, `sub`, `tid`, `exp`)
- `extractAccountId()` — Priority: `oid` > `sub` claim from ID token

### Step 3: Implement Loopback Server
- Bind to `127.0.0.1:53800`
- Handle `/callback` route for authorization code
- Handle `/cancel` route
- Return HTML success/error pages matching app dark theme
- 5-minute timeout on callback promise
- Reject prior pending auth on new authorize() call (from xAI pattern)

### Step 4: Implement Device Code Flow (optional but recommended)
- `requestDeviceCode()` — POST to `/oauth2/v2.0/devicecode`
- `pollDeviceToken()` — Poll loop with `authorization_pending`/`slow_down` handling

### Step 5: Implement Loader (Token Injection)
- Return `apiKey: OAUTH_DUMMY_KEY` + custom `fetch`
- Single-flight refresh deduplication
- JWT exp+skew-based proactive refresh

### Step 6: Register Plugin
- Add to `internalPlugins()` in `packages/opencode/src/plugin/index.ts`
- Add `microsoft` to `ProviderV2.ID` in `packages/core/src/provider.ts`

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Port conflict** (53800 in use) | Low | Medium | Try next port, or use OS-assigned `port: 0` + read actual port |
| **Microsoft redirect URI mismatch** | Medium | High | Microsoft is strict about exact URI match (trailing `/`, case). Must match Azure AD registration exactly |
| **"Unverified app" consent screen** | High | Low | New Azure AD apps show an unverified warning until publisher verification. Users may hesitate. Acceptable for a fork |
| **Refresh token expiration** | Medium | Medium | Microsoft public client refresh tokens expire after 90 days of inactivity. Token refresh with `rotate` pattern needed |
| **Multi-tenant token validation** | Low | Medium | If using `common` endpoint, validate the `tid` claim and optionally restrict to known tenants |
| **Device code not supported in some tenants** | Low | Medium | Some Entra ID policies may disable device code flow. Fall back to PKCE-only |
| **Rate limiting** on token endpoint | Low | Low | Token refresh is infrequent by design. Single-flight dedup already limits concurrent calls |

## Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should tell the user:

> The exploration is done. The xAI plugin at `packages/opencode/src/plugin/xai.ts` is the best template to follow — it has the most complete implementation of both Authorization Code + PKCE (loopback) and Device Code (headless) flows. The recommended approach is to create `packages/opencode/src/plugin/microsoft.ts` following this pattern, register it in `internalPlugins()`, and add the `microsoft` provider ID. A few key differences from xAI: (1) Microsoft uses v2.0 endpoints (`login.microsoftonline.com/{tenant}/...`), (2) PKCE is REQUIRED for public clients (no client secret), (3) tenant configuration must support `common`/`organizations`/`consumers`/specific tenant, and (4) account ID should be extracted from the `oid` claim in the ID token. A device code flow can be added as a separate auth method for headless environments.
