# Design: Microsoft Entra ID / Microsoft Account OAuth2/OIDC Provider

## Technical Approach

Dual-flow auth plugin following the xAI pattern (`packages/opencode/src/plugin/xai.ts`): Authorization Code + PKCE (loopback) for desktop, Device Code (RFC 8628) for headless/VPS, with proactive token refresh and single-flight dedup. A single file `microsoft.ts` exports `MicrosoftAuthPlugin` as `(PluginInput, options?) => Promise<Hooks>` — identical shape to `XaiAuthPlugin`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Single file vs. multi-module** | Single follows xAI/Codex pattern (742 lines); multi-module adds import overhead with no reuse outside this plugin | Single file `microsoft.ts` |
| **Port 53800 vs. dynamic port** | Dynamic avoids conflicts; pinned matches spec (redirect URI registration requires exact value) | Pinned `127.0.0.1:53800` |
| **Client ID from env vs. option** | Env supports CI/deployment; option supports config-override | `MICROSOFT_CLIENT_ID` env fallback to `clientId` option |
| **Tenant in URL vs. query param** | URL path param is Microsoft's documented v2.0 format | `/v2.0/{tenant}/...` path |
| **JWT decode vs. crypto verify** | Verify is safer but needs kid rotation and adds no value for ID token display claims | Unsigned base64url decode (same as xAI/Codex) |

## Data Flow

```
PKCE Flow:
  User CLI → authorize() → generatePKCE() → startOAuthServer(53800)
    → buildAuthorizeUrl(...) → open browser
    → Microsoft redirects → /callback?code=X&state=S
    → validate state → exchangeCodeForTokens(code, verifier)
    → POST /{tenant}/oauth2/v2.0/token
    → parse id_token (oid/sub) → resolve({ refresh, access, expires, accountId })
    → ProviderAuth saves Oauth → done

Device Code Flow:
  User CLI → authorize() → POST /{tenant}/oauth2/v2.0/devicecode
    → return { url, user_code, method: "auto", callback }
    → ProviderAuth shows URL + code → user authorizes in browser
    → callback() → poll POST /{tenant}/oauth2/v2.0/token
    → { authorization_pending → sleep(interval) → retry }
    → { slow_down → interval += 5s → retry }
    → { 200 OK → parse tokens → resolve }
    → ProviderAuth saves Oauth → done

Loader/Refresh Flow:
  fetch() → getAuth() → check expires / JWT exp
    → expires soon? → single-flight refresh → POST /{tenant}/v2.0/token
    → persist rotated tokens → inject Bearer header → fetch
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/plugin/microsoft.ts` | Create | Full auth plugin: PKCE flow, device code, token refresh, ID token parsing |
| `packages/opencode/src/plugin/index.ts` | Modify | Import `MicrosoftAuthPlugin`, add to `internalPlugins()` |
| `packages/core/src/provider.ts` | Modify | Add `microsoft: schema.make("microsoft")` to `ProviderV2.ID` statics |

## Interfaces / Contracts

```typescript
// Config schema (private to module)
interface MicrosoftConfig {
  tenant: string              // "common" | "organizations" | "consumers" | "{tenant-id}"
  clientId: string            // from MICROSOFT_CLIENT_ID env or plugin option
  scopes: string              // "openid email profile offline_access"
  redirectUri: string         // "http://127.0.0.1:53800/callback"
}

// Microsoft endpoints (derived from tenant)
const AUTHORIZE = `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
const TOKEN     = `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
const DEVICE    = `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode`

// ID token claims (unsigned decode — only for oid/sub/exp/tid)
interface MicrosoftIdToken {
  oid?: string    // accountId (preferred)
  sub?: string    // accountId (fallback)
  tid?: string    // tenant ID (for multi-tenant validation)
  exp?: number    // expiry for proactive refresh
  preferred_username?: string
}
```

## Error Handling Strategy

| Microsoft Error | Map To | Behavior |
|----------------|--------|----------|
| `access_denied` | User denied consent | Reject callback, show `HTML_ERROR` |
| `authorization_pending` | RFC 8628 retry | Poll loop continues at same interval |
| `slow_down` | Backoff | Poll interval += 5s |
| `expired_token` | Device code expired | Reject with "re-run login" message |
| `invalid_grant` (refresh) | Token expired/revoked | Pass request without Bearer (401 surfaces upstream) |
| `EADDRINUSE` on 53800 | Port conflict | Reject `authorize()` with clear error |

## Security Considerations

- **PKCE**: S256 code challenge via `crypto.subtle.digest("SHA-256")` — no client secret needed (public client)
- **State**: 32-byte random via `crypto.getRandomValues()`, validated on callback (CSRF protection)
- **Redirect**: Pinned to `127.0.0.1:53800/callback` — not configurable (mitigates DNS rebinding)
- **Storage**: Auth persisted via `Auth.Service.set()` — uses `0o600` file mode via `writeJson`
- **ID token**: Unsigned decode only (same as xAI/Codex) — trust chain is the TLS + Microsoft token endpoint, not local JWT verify
- **Single-flight refresh**: `let refreshPromise` collapses concurrent refresh calls onto one HTTP request — prevents refresh token rotation races
- **Timeout**: OAuth callback rejects after 5 minutes; new `authorize()` rejects prior pending

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | PKCE generation, state gen, JWT claim parsing, OAuth callback handler | Pure function tests with known inputs — no HTTP |
| Unit | `buildAuthorizeUrl()`, `accessTokenIsExpiring()` | Verify URL params, expiry edge cases |
| Unit | Device code poll backoff (`authorization_pending`, `slow_down`) | Inject mock `sleep` + `now` functions (same pattern as xAI tests) |
| Integration | Full PKCE flow (mock HTTP) | `testEffect()` with mock token endpoint — verify state validation, code exchange, token storage |
| Integration | Full device code flow (mock HTTP) | Simulate poll cycle with `authorization_pending` → success |
| Integration | Token refresh with single-flight | Two concurrent fetch calls — verify only one HTTP refresh, both get same token |

## Migration / Rollout

No migration required. New provider, no existing users to migrate. Register in `internalPlugins()` alongside xAI.

## Open Questions

- [ ] Default `MICROSOFT_CLIENT_ID` for development? xAI ships a known public client ID — Microsoft requires developer tenant app registration. If no default, the error message on first use must be clear.
