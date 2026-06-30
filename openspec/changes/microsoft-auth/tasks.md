# Tasks: Microsoft Auth Provider

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Plugin) → PR 2 (Tests) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Plugin + wiring | PR 1 | `microsoft.ts`, `index.ts`, `provider.ts` — base: main |
| 2 | Tests | PR 2 | Unit + integration — base: main |

## Phase 1: Foundation

- [ ] 1.1 Add `microsoft` to `ProviderV2.ID` in `packages/core/src/provider.ts`
- [ ] 1.2 Create `microsoft.ts` — config schema (tenant, clientId, scopes, redirectUri with env fallback), `MicrosoftIdToken` parser, tenant-derived endpoints

## Phase 2: PKCE Flow

- [ ] 2.1 PKCE helpers: `generatePKCE()` (S256 challenge), `generateState()` (32-byte base64url)
- [ ] 2.2 `buildAuthorizeUrl()` — MS v2.0 tenant-path format, S256 challenge, state, OIDC scopes
- [ ] 2.3 Loopback server: `startOAuthServer(53800)` → `waitForOAuthCallback()` → `stopOAuthServer()`
- [ ] 2.4 `exchangeCodeForTokens()` — POST `/{tenant}/oauth2/v2.0/token` with `authorization_code` + PKCE verifier
- [ ] 2.5 PKCE `authorize()` — generate PKCE, open URL, await callback, resolve + persist tokens

## Phase 3: Device Code Flow

- [ ] 3.1 `requestDeviceCode()` — POST `/{tenant}/oauth2/v2.0/devicecode`
- [ ] 3.2 `pollDeviceCodeToken()` — RFC 8628 backoff: `authorization_pending`, `slow_down`, `expired_token`, timeout
- [ ] 3.3 Device code `authorize()` — return verification URL + `user_code`, poll callback, resolve tokens

## Phase 4: Token Refresh / Loader

- [ ] 4.1 `accessTokenIsExpiring()` — JWT `exp` claim check with skew window
- [ ] 4.2 `refreshAccessToken()` — POST `/{tenant}/oauth2/v2.0/token` with `refresh_token` grant
- [ ] 4.3 `loader()` — single-flight dedup, proactive refresh, persist rotated tokens, inject Bearer + User-Agent

## Phase 5: Assembly & Registration

- [ ] 5.1 Export `MicrosoftAuthPlugin()` — `auth.provider: "microsoft"`, 3 methods (PKCE, Device Code, API Key), OAUTH_DUMMY_KEY fetch override
- [ ] 5.2 Register in `packages/opencode/src/plugin/index.ts` — import `MicrosoftAuthPlugin`, add to `internalPlugins()`

## Phase 6: Unit Tests

- [ ] 6.1 PKCE generation (verifier length, base64url charset, S256 challenge correctness)
- [ ] 6.2 JWT claim parsing (`accessTokenIsExpiring` — expired, fresh, opaque, malformed)
- [ ] 6.3 Config defaults (tenant="common", env fallback for clientId, scopes, redirectUri value)
- [ ] 6.4 State validation (32-byte base64url, mismatch rejection in callback handler)

## Phase 7: Integration Tests

- [ ] 7.1 Full PKCE flow with mock HTTP — state validation, code exchange, token storage
- [ ] 7.2 Full device code flow — mock poll cycle: `authorization_pending` → `slow_down` → success
- [ ] 7.3 Token refresh single-flight — concurrent fetches, one HTTP refresh, both get same token
- [ ] 7.4 Error paths — port conflict (`EADDRINUSE`), `access_denied`, `expired_token`, `invalid_grant` refresh, 5min timeout
- [ ] 7.5 ID token extraction — `oid` preferred, `sub` fallback, `tid` parsing

## Phase 8: Verification

- [ ] 8.1 Manual verification checklist — Azure AD app registration, PKCE auth loopback, device code auth, token refresh, error scenarios
