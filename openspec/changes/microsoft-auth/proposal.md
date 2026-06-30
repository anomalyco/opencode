# Proposal: Microsoft Entra ID / Microsoft Account OAuth authentication provider

## Intent

Add Microsoft Entra ID (work/school) and Microsoft Account (personal) as an OAuth2/OIDC authentication provider for OpenCode CLI. Users with Microsoft-backed AI models (e.g., Azure OpenAI, GitHub Models) currently have no way to authenticate via OpenCode — this bridges that gap by adding a first-class Microsoft OAuth provider following the same patterns as xAI and Codex.

## Scope

### In Scope
- New auth plugin: `packages/opencode/src/plugin/microsoft.ts`
- Registration in `packages/opencode/src/plugin/index.ts` internalPlugins()
- Add `microsoft` to `ProviderV2.ID` in `packages/core/src/provider.ts`
- Primary: Authorization Code + PKCE (loopback on `127.0.0.1:53800/callback`)
- Secondary: Device Code Flow (RFC 8628) for headless/VPS/SSH
- Token refresh with single-flight dedup, 90d inactivity expiry handling
- Account ID extraction from ID token `oid` claim
- Tenant config: `common`, `organizations`, `consumers`, `{tenant-id}`

### Out of Scope
- Microsoft Graph API integration
- Copilot model consumption via Microsoft auth
- SSO/Enterprise features beyond basic OAuth login
- WAM/MSAL native broker integration

## Capabilities

### New Capabilities
- `microsoft-auth`: Microsoft Entra ID / Microsoft Account OAuth2/OIDC provider — PKCE loopback flow for desktop, Device Code flow for headless, token refresh with rotation, tenant configuration

### Modified Capabilities
- `auth-architecture-baseline`: Add Microsoft provider to existing OAuth provider matrix — new provider entry with endpoints, scopes, and flow requirements

## Approach

Follow the xAI plugin pattern (`packages/opencode/src/plugin/xai.ts`) — the most mature dual-flow auth plugin in the codebase:

1. **PKCE + Loopback (desktop)**: Generate S256 code challenge, open browser to Microsoft v2.0 `/authorize`, receive code on `127.0.0.1:53800/callback`, exchange for tokens
2. **Device Code (headless)**: POST to `/oauth2/v2.0/devicecode`, print URL + user code, poll with `authorization_pending`/`slow_down` backoff (RFC 8628)
3. **Token lifecycle**: Exchange → store `Oauth` (refresh+access+expires+accountId) → proactive refresh via JWT `exp` claim + stored expiry with single-flight dedup
4. **Microsoft v2.0 endpoints**: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{authorize,token,devicecode}`
5. **Client ID**: Plugin option + `MICROSOFT_CLIENT_ID` env var fallback — no client secret (public client)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/opencode/src/plugin/microsoft.ts` | New | Full auth plugin (PKCE flow, device code, token refresh, JWT claim parsing) |
| `packages/opencode/src/plugin/index.ts` | Modified | Add `MicrosoftAuthPlugin` to `internalPlugins()` |
| `packages/core/src/provider.ts` | Modified | Add `microsoft` to `ProviderV2.ID` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Redirect URI strict matching (trailing `/`, case) | Low | Pin exact URI in constants; document registration requirement |
| Port 53800 conflict | Low | Clear error message; document port override option |
| Unverified app consent screen | High | Acceptable for fork; document expected UX in README |
| Refresh token expiry (90d inactivity) | Medium | Proactive refresh before expiry; clear re-auth prompt on failure |
| Device Code disabled in tenant policy | Low | PKCE flow always available as fallback |

## Rollback Plan

Revert: remove `MicrosoftAuthPlugin` from `internalPlugins()`, delete `microsoft.ts`, revert `provider.ts` addition. No data migration needed — new provider, no existing users to migrate.

## Dependencies

- Azure AD app registration (public client) with redirect URI `http://localhost:53800/callback`
- Client ID from said registration — configurable via plugin option or `MICROSOFT_CLIENT_ID` env var

## Success Criteria

- [ ] `bun test` passes for `packages/opencode` and `packages/core`
- [ ] Auth Code + PKCE flow completes: browser opens, user authenticates, callback succeeds, tokens persisted as `Oauth`
- [ ] Device Code flow: user code displayed, poll loop succeeds
- [ ] Token refresh works: stale token auto-refreshes before 401, rotated refresh persisted
- [ ] `microsoft` provider ID listed in available providers
