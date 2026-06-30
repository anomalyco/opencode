# microsoft-auth Specification

## Purpose

Microsoft Entra ID / Microsoft Account OAuth2/OIDC provider for OpenCode CLI. Dual-flow auth: Authorization Code + PKCE (desktop) and Device Code (headless), with token refresh and tenant configuration.

## Requirements

### Requirement: Plugin Registration

The plugin MUST register as `provider: "microsoft"` with an AuthHook containing two OAuth flow methods and one API key fallback.

| Method | Type | Label |
|--------|------|-------|
| PKCE Loopback | oauth | Microsoft Account (Browser) |
| Device Code | oauth | Microsoft Account (Headless/VPS) |
| API Key | api | Manually enter API Key |

#### Scenario: Plugin loaded

- GIVEN `MicrosoftAuthPlugin` is exported
- WHEN `internalPlugins()` is called
- THEN `auth.provider` is `"microsoft"`, `loader` returns `{ apiKey: OAUTH_DUMMY_KEY, fetch }`, and `methods` has 3 entries

### Requirement: Auth Code + PKCE Flow

The `authorize` method MUST start a loopback server on `127.0.0.1:53800/callback`, generate S256 PKCE verifier/challenge, build the Microsoft authorize URL, and wait for the callback. On callback, it MUST exchange the `code` + `code_verifier` for tokens.

#### Scenario: PKCE flow succeeds

- GIVEN the server is bound to `127.0.0.1:53800`
- WHEN Microsoft redirects to `/callback?code=XYZ&state=ABC`
- THEN the code is exchanged via POST to `/oauth2/v2.0/token` with `grant_type=authorization_code` and `code_verifier`
- AND tokens (refresh, access, expires, accountId) are saved as `Oauth`
- AND the browser shows `HTML_SUCCESS`

#### Scenario: State mismatch

- GIVEN `pendingOAuth.state` is `"ABC"`
- WHEN callback receives `state=XYZ`
- THEN server responds 400 with `HTML_ERROR("Invalid state")`
- AND callback promise rejects

#### Scenario: Error parameter in redirect

- GIVEN Microsoft redirects with `error=access_denied&error_description=User+denied`
- WHEN callback receives the error
- THEN server responds with `HTML_ERROR("User denied")`
- AND callback promise rejects

### Requirement: Device Code Flow

The `authorize` method MUST POST to `/{tenant}/oauth2/v2.0/devicecode`, return the verification URL and `user_code`, and poll the token endpoint per RFC 8628.

#### Scenario: Device code succeeds

- GIVEN `device_code`, `user_code`, and `verification_uri` are returned
- WHEN the user authorizes and the poll receives a 200 response
- THEN tokens (refresh, access, expires) are saved as `Oauth`
- AND the method returns `{ type: "success" }`

#### Scenario: Slow down and authorization_pending

- GIVEN the token endpoint returns `{ error: "authorization_pending" }`
- WHEN polling at the server-suggested interval
- THEN the loop continues without error
- AND if `error: "slow_down"` is received, the interval is increased by >= 5s

### Requirement: Token Refresh (Loader)

The `loader` MUST return a `fetch` override that checks token expiry (stored `expires` or JWT `exp` claim) before every request and refreshes proactively with single-flight dedup.

#### Scenario: Proactive refresh before 401

- GIVEN stored `expires` is within 120s of `Date.now()` — or JWT `exp` is within skew
- WHEN a fetch call is made
- THEN a `refresh_token` grant is sent to the token endpoint
- AND rotated tokens are persisted as `Oauth`
- AND the fetch proceeds with the new `access_token`

#### Scenario: Concurrent refresh collapsed

- GIVEN two fetch calls arrive simultaneously
- WHEN both detect the token is expiring
- THEN only one HTTP refresh is issued
- AND both fetches resolve with the same refreshed token

### Requirement: Tenant Configuration

The plugin MUST accept a `tenant` option defaulting to `"common"`. Supported values: `"common"`, `"organizations"`, `"consumers"`, or a specific tenant ID.

#### Scenario: Tenant drives endpoint

- GIVEN `tenant` is `"contoso.com"`
- WHEN building the authorize or token URL
- THEN the endpoint is `https://login.microsoftonline.com/contoso.com/oauth2/v2.0/{action}`

### Requirement: Account ID Extraction

The `callback` MUST extract `accountId` from the ID token's `oid` claim, falling back to `sub`.

#### Scenario: oid claim present

- GIVEN the ID token JWT payload has `{ "oid": "guid-abc" }`
- WHEN the callback processes tokens
- THEN `accountId` is `"guid-abc"`

### Requirement: Error Handling

The plugin MUST handle port conflicts, consent denial, expired tokens, and Microsoft error responses with clear messages.

#### Scenario: Port 53800 conflict

- GIVEN port 53800 is already bound
- WHEN `startOAuthServer()` is called
- THEN the promise rejects with `EADDRINUSE`

#### Scenario: Token refresh fails (90d inactivity)

- GIVEN the refresh token has expired due to 90d inactivity
- WHEN the refresh grant returns 400
- THEN the fetch proceeds without a bearer token (401 will surface upstream)
- AND the loader does NOT crash

### Non-Functional

- **Single-flight**: Concurrent fetch refreshes collapse into one HTTP call
- **Timeout**: Auth callback rejects after 5 minutes; prior pending auth is rejected on new `authorize()`
- **Safety margin**: Device code polling adds `OAUTH_POLLING_SAFETY_MARGIN_MS` to each wait

### Interface Contracts

**Client ID**: `process.env.MICROSOFT_CLIENT_ID` || plugin option `clientId`
**Endpoints**: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{authorize|token|devicecode}`
**Scopes**: `openid email profile offline_access`
**Redirect**: `http://127.0.0.1:53800/callback`
**Token storage**: `Oauth { type: "oauth", refresh, access, expires, accountId? }`
**Account ID**: from ID token `oid` claim (preferred), `sub` claim (fallback)
**ID token parse**: Unsigned JWT decode — `JSON.parse(atob(payload))` — for `oid`, `sub`, `tid`, `exp` only; no signature verification (trust decisions use token response from Microsoft, not local decode)
