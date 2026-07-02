# Microsoft Entra ID Login Gate

OpenCode implements a **mandatory login gate** that runs before either the
desktop app window or the CLI tool can be used. The gate accepts two
authentication methods:

1. **Microsoft Entra ID** (formerly Azure Active Directory) via the OAuth2
   Authorization Code flow with **PKCE**.
2. **Local admin bypass** with a hardcoded username / password pair.

If the gate cannot be satisfied, the desktop app calls `app.exit(1)` and the
CLI tool calls `process.exit(1)`. The gate can also be fully disabled with a
single environment variable for local development and CI.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [Files involved](#files-involved)
- [Default credentials](#default-credentials)
- [Environment variables](#environment-variables)
- [OAuth2 PKCE flow](#oauth2-pkce-flow)
- [Admin bypass mechanism](#admin-bypass-mechanism)
- [Auth persistence](#auth-persistence)
- [Azure AD app registration requirements](#azure-ad-app-registration-requirements)
- [Device-code flow (headless / remote)](#device-code-flow-headless--remote)
- [Token refresh and proactive re-auth](#token-refresh-and-proactive-re-auth)
- [Development shortcuts](#development-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Architecture overview

The login gate is intentionally duplicated across three independent surfaces
so neither the desktop app nor the CLI tool depends on the other to enforce
authentication:

| Surface | Entry point | Decision point |
| --- | --- | --- |
| Desktop Electron app | `enforceDesktopLogin` in `packages/desktop/src/main/login-gate.ts` | Called from `packages/desktop/src/main/index.ts` after the sidecar boots and **before** the main window is created |
| CLI tool | `enforceMicrosoftLogin` in `packages/opencode/src/cli/login-gate.ts` | Called from the CLI command that requires authentication |
| Auth plugin | `MicrosoftAuthPlugin` in `packages/opencode/src/plugin/microsoft.ts` | Exposed to the opencode auth system; the plugin also implements the same PKCE flow plus a **device-code flow** for headless / VPS environments |

The desktop and CLI gate share the exact same default tenant, client ID,
scopes, redirect URI, and admin credentials so the behaviour is identical
across surfaces. The plugin is used when opencode itself negotiates the auth
(e.g. when the user picks the Microsoft option in the built-in auth picker).

All three implementations:

- Use **PKCE** (no client secret stored in the client).
- Spin up a **local loopback HTTP server on `127.0.0.1:53800`** to receive
  the redirect from Microsoft.
- Persist the resulting tokens via the auth store (`XDG_DATA_HOME/opencode/auth.json`).

### Wiring (desktop)

In `packages/desktop/src/main/index.ts` the gate is invoked between sidecar
readiness and the main window:

```ts
yield* Effect.promise(() => enforceDesktopLogin(url, password))

mainWindow = createMainWindow()
```

`url` and `password` are the Basic-auth credentials the sidecar uses to
expose the local HTTP API. The login window's renderer is loaded from a
**temp file** (`win.loadFile`) written with the inline `HTML_LOGIN` template,
with the preload script at `packages/desktop/src/preload/login.ts` exposing
`window.loginApi`.

> **Why a temp file and not `data:text/html`?** Electron 42 packaged builds
> on Windows may not execute preload scripts when the page is loaded via a
> `data:` URL (opaque origin). Writing the HTML to a temp file and loading
> it with `win.loadFile()` gives the page a proper `file://` origin and
> eliminates the edge case entirely.

### Wiring (CLI)

In the CLI the gate is invoked from the command that needs auth. The CLI
uses stdin prompts (TTY only) to collect the admin credentials and falls
back to the Microsoft flow if the user is not a TTY.

---

## Files involved

| File | Role |
| --- | --- |
| `packages/desktop/src/main/login-gate.ts` | Desktop gate. Defines the `BrowserWindow` login dialog, the PKCE loopback server (`startOAuthServer`), the Microsoft OAuth browser flow (`runMicrosoftOAuth`), the admin credential validator, the bypass check, the existing-auth probe, and a **`preload-error` listener** on the login window that logs preload loading failures. |
| `packages/desktop/src/main/index.ts` | Calls `enforceDesktopLogin` after the sidecar is ready and before `createMainWindow`. |
| `packages/desktop/src/preload/login.ts` | Preload script. Exposes `window.loginApi.submitAdmin(username, password)` and `window.loginApi.startMicrosoftOAuth()` to the renderer through `contextBridge`. |
| `packages/opencode/src/plugin/microsoft.ts` | Shared Microsoft auth plugin. Implements PKCE helpers, the loopback server, token exchange, **device-code flow** (`/oauth2/v2.0/devicecode`), proactive token refresh with single-flight dedup, and a `requireClientId` guard. Used by the opencode auth picker. |
| `packages/opencode/src/cli/login-gate.ts` | CLI gate. Mirrors the desktop gate's behaviour: bypass check, TTY admin prompt, existing-auth probe, PKCE Microsoft flow, token persistence via `Auth.Service`. |

> **Desktop / preload convention.** The renderer process should only call
> `window.api` from the preload, and the main process registers IPC handlers
> in `src/main/ipc.ts`. The login gate is the only exception: it registers
> `login-admin` and `login-microsoft` locally inside the gate and removes
> them when the login window closes. (`packages/desktop/AGENTS.md`)

---

## Default credentials

The build ships with a single Azure AD app registration owned by **OneInfo
Consulting** and a single local admin pair. Both can be overridden with
environment variables at runtime without rebuilding.

| Setting | Default value | Where it is defined |
| --- | --- | --- |
| **Microsoft tenant** | `oneinfoconsulting.com` (domain form) | `DEFAULT_TENANT` in `desktop/src/main/login-gate.ts`, `cli/login-gate.ts`, and `plugin/microsoft.ts` |
| **Microsoft client (app) ID** | `cb06d541-ed31-4195-b7ff-d2b50084da6f` | `DEFAULT_CLIENT_ID` / `CLIENT_ID` in the same three files |
| **Default scopes** | `openid email profile offline_access` | `DEFAULT_SCOPES` in the same three files |
| **Redirect URI** | `http://127.0.0.1:53800/callback` | `OAUTH_HOST` / `OAUTH_PORT` / `OAUTH_REDIRECT_PATH` constants |
| **Admin username** | `admin` | `ADMIN_DEFAULT_USERNAME` |
| **Admin password** | `opencode-admin` | `ADMIN_DEFAULT_PASSWORD` |
| **OAuth host** | `127.0.0.1` (loopback only) | `OAUTH_HOST` |
| **OAuth port** | `53800` | `OAUTH_PORT` |
| **OAuth callback timeout** | `5 * 60 * 1000` ms (5 min) | `OAUTH_CALLBACK_TIMEOUT_MS` (plugin) |

> **Security note.** The admin password is a constant in the source tree.
> It exists to give operators a "break glass" path when Microsoft is
> unavailable, not as a primary auth mechanism. Override it with
> `OPENCODE_ADMIN_USERNAME` and `OPENCODE_ADMIN_PASSWORD` for any real
> deployment.

### Tenant caveat (read this first)

The constants in source use the **tenant GUID** (`3219b5f9-...`) but the
public-facing verified domain for the same tenant is **`oneinfoconsulting.com`**.
Microsoft accepts either form for the `tenant` path in
`https://login.microsoftonline.com/{tenant}/...`, but the GUID is rejected
with `AADSTS900023` (HTTP 400) if the app registration cannot be resolved
under that exact identifier (e.g. when the app lives in a different
directory than the one the GUID was issued for, or when the GUID has been
copied wrong). When the GUID is rejected, override the tenant at runtime:

```bash
MICROSOFT_TENANT=oneinfoconsulting.com opencode
```

See the [troubleshooting section](#aadsts900023-tenant-not-found) for
details.

---

## Environment variables

Every override is read at process start. None of them require a rebuild.

### Authentication control

| Variable | Effect | Default | Read in |
| --- | --- | --- | --- |
| `MICROSOFT_LOGIN_BYPASS=1` | Skip the entire gate (no Microsoft, no admin). | unset | All three files (`isBypassEnabled`) |
| `OPENCODE_ADMIN_USERNAME` | Override the admin username. | `admin` | desktop and CLI gates |
| `OPENCODE_ADMIN_PASSWORD` | Override the admin password. | `opencode-admin` | desktop and CLI gates |

### Microsoft OAuth configuration

| Variable | Effect | Default | Read in |
| --- | --- | --- | --- |
| `MICROSOFT_CLIENT_ID` | Override the Azure AD app client ID. | `cb06d541-ed31-4195-b7ff-d2b50084da6f` | All three files (desktop, CLI, plugin) |
| `MICROSOFT_TENANT` | Override the Azure AD tenant. Accepts domain or GUID form. | `oneinfoconsulting.com` | All three files |
| `MICROSOFT_SCOPES` | Override the OAuth scopes (space-separated). | `openid email profile offline_access` | desktop gate, CLI gate |
| `MICROSOFT_REDIRECT_URI` | Override the redirect URI (and implicitly the loopback port). | `http://127.0.0.1:53800/callback` | CLI gate only |

> The desktop gate and the plugin **do not** read
> `MICROSOFT_REDIRECT_URI`. The redirect URI is hardcoded to
> `http://127.0.0.1:53800/callback` in both, so it matches the AAD
> registration exactly. If you need a different port, change it in the AAD
> app and rebuild, or use the CLI which honours the env var.

### Other related variables

| Variable | Effect |
| --- | --- |
| `OPENCODE_TEST_ONBOARDING=1` | Boots the desktop app in an isolated `tmpdir` (see `packages/desktop/src/main/index.ts`). |
| `XDG_DATA_HOME` | Overrides the base for the auth store. Default `~/.local/share` on Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows. |

---

## OAuth2 PKCE flow

PKCE (Proof Key for Code Exchange, RFC 7636) prevents authorization code
interception attacks without requiring a client secret. The flow used in
OpenCode is the standard Microsoft v2.0 endpoint.

### Step-by-step

1. **Generate PKCE codes** (`generatePKCE`).
   - Generate a 64-character random string from the unreserved
     `[A-Za-z0-9-._~]` set → `code_verifier`.
   - Hash it with `SHA-256` and base64url-encode (no padding) →
     `code_challenge`.
2. **Generate a CSRF `state` token** (`generateState`): 32 random bytes
   base64url-encoded. The callback handler rejects any redirect whose
   `state` does not match — a mismatched state surfaces the error
   `Invalid state - potential CSRF attack`.
3. **Start the loopback HTTP server** (`startOAuthServer`) on
   `127.0.0.1:53800` with the routes below.
4. **Build the authorize URL**:

   ```text
   https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
     ?response_type=code
     &client_id={clientId}
     &redirect_uri=http://127.0.0.1:53800/callback
     &scope=openid%20email%20profile%20offline_access
     &code_challenge={code_challenge}
     &code_challenge_method=S256
     &state={state}
     &prompt=select_account
   ```

   The `prompt=select_account` parameter forces the account picker every
   time, even on a tenant where the user has a single SSO session.
5. **Open the URL in the user's browser**:
   - Desktop: `electron.shell.openExternal(authUrl)`.
   - CLI: the `open` package (`UI.println` also prints the URL as a
     fallback for environments where the browser cannot be launched).
6. **Receive the callback** at `GET /callback` on the loopback server.
   The server validates `state`, extracts the `code`, and then calls
   `exchangeCodeForTokens` (below). It renders `HTML_SUCCESS` to the
   browser tab.
7. **Exchange the code** at
   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
   with `application/x-www-form-urlencoded`:

   ```text
   grant_type=authorization_code
   code={code}
   redirect_uri=http://127.0.0.1:53800/callback
   client_id={clientId}
   code_verifier={code_verifier}
   ```

   The response contains `access_token`, `refresh_token`, optional
   `id_token`, and `expires_in`.
8. **Extract the account ID** (`extractAccountId`): decode the `id_token`
   (or, as a fallback, the `access_token`) and use the `oid` claim, falling
   back to `sub` for personal Microsoft accounts that omit `oid`.
9. **Persist** `{ type: "oauth", access, refresh, expires, accountId? }`
   to the auth store keyed under `microsoft`.
10. **Stop the loopback server** (`stopOAuthServer`).

### Loopback server routes

| Route | Behaviour |
| --- | --- |
| `GET /callback?code=...&state=...` | Validates `state`, exchanges the code, responds with `HTML_SUCCESS` or `HTML_ERROR`. |
| `GET /cancel` | Rejects the pending OAuth with `Login cancelled`. |
| Anything else | `404 Not found`. |

The server is **single-shot** in the desktop gate: `startOAuthServer` is
a no-op if the server is already running. The plugin's server is reused
across login attempts and uses `waitForOAuthCallback` to attach a per-
request config. A new authorize request supersedes any previous pending
OAuth.

---

## Admin bypass mechanism

The admin bypass is a local credential check, **not** a remote auth call.
It exists so an operator can unlock the gate without contacting Microsoft.

### Desktop

The login `BrowserWindow` exposes two buttons:

- **Sign in with Microsoft** → triggers `login-microsoft` IPC → `runMicrosoftOAuth`.
- **Sign in (admin)** → triggers `login-admin` IPC → `validateAdmin`.

Diagnostic instrumentation (added July 2026):

- **`preload-error` listener** — logs preload loading failures to `electron-log`
  with the resolved path and error message.
- **Defensive HTML fallback** — checks `window.loginApi` on `DOMContentLoaded`.
  If undefined, shows an error message, disables both buttons, and logs to
  `console.error` (captured by `electron-log` via `spyRendererConsole: true`).
- **Module-level `PRELOAD_ROOT`** — same pattern as `windows.ts` for consistent
  preload path resolution in both dev and packaged builds.

`validateAdmin` is a constant-time **string equality** check (not timing-
safe; do not rely on it as a real auth boundary):

```ts
const expectedUser = process.env["OPENCODE_ADMIN_USERNAME"] ?? "admin"
const expectedPass = process.env["OPENCODE_ADMIN_PASSWORD"] ?? "opencode-admin"
return username === expectedUser && password === expectedPass
```

If the credentials match, the renderer IPC resolves, the window closes,
and the gate is considered passed. The credentials are **not** persisted
anywhere; the user is prompted again on the next launch.

### CLI

The CLI prompts on stdin (`UI.input`):

```text
Admin bypass (Ctrl+C to cancel)
Admin username: admin
Admin password:
OK admin bypass accepted
```

The CLI is stricter than the desktop: it only offers the admin prompt if
`process.stdin.isTTY && process.stdout.isTTY`. In CI or piped contexts
the user must either set `MICROSOFT_LOGIN_BYPASS=1` or complete the full
Microsoft flow. Wrong credentials call `process.exit(1)` (no retry).

---

## Auth persistence

### Storage location

The desktop gate reads auth directly from disk to decide whether the gate
is needed:

```text
$XDG_DATA_HOME/opencode/auth.json
```

On Linux the default is `~/.local/share/opencode/auth.json`, on macOS
`~/Library/Application Support/opencode/auth.json`, on Windows
`%APPDATA%\opencode\auth.json`.

### Shape

The relevant block is keyed by `microsoft`:

```json
{
  "microsoft": {
    "type": "oauth",
    "access": "eyJ0eXAi...",
    "refresh": "0.ARoA...",
    "expires": 1735689600000,
    "accountId": "00000000-0000-0000-0000-000000000000"
  }
}
```

`accountId` is the `oid` (or `sub`) claim from the `id_token` /
`access_token`. The gate only requires `type === "oauth"` and the presence
of `access` and `refresh`; an existing record is sufficient to skip the
gate on the next launch.

The CLI uses `Auth.Service` (`auth.get("microsoft")`) to perform the same
check and `auth.set("microsoft", ...)` to write the new tokens.

---

## Azure AD app registration requirements

The shipped app registration (`cb06d541-ed31-4195-b7ff-d2b50084da6f`) is a
**public client / native** app in the OneInfo Consulting tenant. To
recreate it in another tenant or to migrate to your own app, register a new
app at
<https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade>
with the following configuration:

### Required configuration

| Setting | Value |
| --- | --- |
| Application type | **Public client / native** (single-page apps can also work; do **not** use a confidential/web app — there is no client secret) |
| Authentication → Mobile and desktop applications → Redirect URI | `http://127.0.0.1:53800/callback` |
| Authentication → Mobile and desktop applications → Redirect URI (alternative for headless) | `https://login.microsoftonline.com/common/oauth2/nativeclient` is **not** needed unless you wire the device-code flow through the same client |
| API permissions → Microsoft Graph | `openid`, `email`, `profile`, `offline_access` (delegated) |
| Authentication → Advanced settings → Allow public client flows | **Yes** (required for PKCE without a secret) |
| Authentication → Implicit grant | **No** (PKCE only) |
| Token configuration → Optional claims | `oid` (recommended — makes `extractAccountId` deterministic) |

> The exact redirect URI **must** match — including the scheme
> (`http` vs `https`), the host (`127.0.0.1` vs `localhost`), the port
> (`53800`), and the path (`/callback`). Microsoft performs an exact
> string match.

### Why `127.0.0.1` and not `localhost`?

The loopback server binds explicitly to `127.0.0.1` (not `::1` and not
`localhost`). Registering `http://localhost:53800/callback` in AAD will
**fail** the redirect match because Microsoft's v2.0 endpoint compares the
registered URI to the URL the browser actually visits, and most browsers
will resolve `localhost` to `::1` first on dual-stack systems.

### Scopes

The default scope set is:

```text
openid email profile offline_access
```

`offline_access` is the **Microsoft-equivalent of `refresh_token`** and
must be present for the plugin to keep refreshing access tokens. The
plugin uses it for the proactive-refresh path described below; without it
the access token expires after `expires_in` (typically 1 hour) and the
plugin falls back to the 401-on-call path.

---

## Device-code flow (headless / remote)

The plugin (`MicrosoftAuthPlugin`) exposes **two** OAuth methods, both
visible in the opencode auth picker:

1. **Microsoft Entra ID / Microsoft Account (Browser)** — PKCE + loopback
   server. Requires a browser.
2. **Microsoft Entra ID / Microsoft Account (Headless / Remote / VPS)** —
   [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) device-code flow. The
   user visits `https://microsoft.com/devicelogin` (or the
   `verification_uri` from the response) on any device and types the
   `user_code`. The CLI polls the token endpoint until authorization
   completes.

The device-code flow uses the same `client_id` and `tenant` as the browser
flow. Polling rules (from `pollDeviceCodeToken`):

- Default poll interval: 5s (floored to a 1s minimum to avoid hammering).
- `authorization_pending`: keep polling at the current interval.
- `slow_down`: bump the interval by +5s.
- `access_denied` / `authorization_declined`: terminal error.
- `expired_token`: terminal error.
- Default expiry: 15 minutes.

Both flows use the same `MicrosoftConfig`, so overriding
`MICROSOFT_TENANT` and `MICROSOFT_CLIENT_ID` is enough to point either
flow at a different AAD app.

---

## Token refresh and proactive re-auth

The plugin's `auth.loader` wraps `fetch` so every outgoing request carries
a fresh access token. The flow is:

1. **Read current auth** from the store via `getAuth()`.
2. **Check expiry** with a 120-second safety skew
   (`ACCESS_TOKEN_REFRESH_SKEW_MS`): if `expires - now <= 120s`, refresh
   proactively.
3. **Single-flight refresh**: if two requests trigger the refresh at the
   same time, they share the same `refreshPromise` and only one network
   call hits Microsoft's token endpoint.
4. **Refresh** at
   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`:

   ```text
   grant_type=refresh_token
   refresh_token={refresh_token}
   client_id={clientId}
   scope=openid email profile offline_access
   ```

5. **Persist** the new `access` / `refresh` / `expires` (and `accountId`
   if a new `oid` appears) via `input.client.auth.set(...)`.
6. **Set** `authorization: Bearer {access_token}` and the opencode
   `User-Agent` on the original request, then `fetch` it.

If the proactive path is bypassed (opaque token, no `exp` claim), the
401-on-call recovery path is the fallback.

---

## Development shortcuts

### Skip the gate entirely (recommended for local dev)

```bash
# Desktop
MICROSOFT_LOGIN_BYPASS=1 opencode-desktop

# CLI
MICROSOFT_LOGIN_BYPASS=1 opencode
```

`MICROSOFT_LOGIN_BYPASS=1` is honoured by all three surfaces and short-
circuits the gate immediately after the env-var check.

### Point at a different AAD app (for testing)

```bash
MICROSOFT_CLIENT_ID=11111111-2222-3333-4444-555555555555 \
MICROSOFT_TENANT=oneinfoconsulting.com \
opencode
```

### Point the CLI at a different loopback port

The CLI reads `MICROSOFT_REDIRECT_URI`. The corresponding AAD app must
register the same URI:

```bash
MICROSOFT_REDIRECT_URI=http://127.0.0.1:53999/callback opencode
```

(For the desktop app, change the constant in source and rebuild.)

### Override admin credentials

```bash
OPENCODE_ADMIN_USERNAME=root \
OPENCODE_ADMIN_PASSWORD=s3cret \
opencode
```

### Reset stored tokens

Delete the auth file:

```bash
rm -f ~/.local/share/opencode/auth.json
```

---

## Troubleshooting

### AADSTS900023 (tenant not found)

Microsoft returns `AADSTS900023` when the tenant identifier in the URL
does not resolve to a directory the app belongs to. The default tenant is
`oneinfoconsulting.com` (domain form). If your organisation uses a
different tenant, override it via `MICROSOFT_TENANT`:

If the app was actually registered in a different directory, you also
need to register it in the `oneinfoconsulting.com` directory (or change
both the app and the tenant to match).

### `AADSTS50011` (redirect URI mismatch)

The redirect URI sent to Microsoft does not match any URI registered on
the AAD app. Verify:

- The exact URI is `http://127.0.0.1:53800/callback` (no trailing slash,
  no `localhost` substitution).
- The AAD app is registered as a **public client** (PKCE does not require
  a secret, but the registration type still affects which redirect URIs
  are accepted).
- If you set `MICROSOFT_REDIRECT_URI` on the CLI, the AAD app has the
  same value.

### Port `53800` already in use

The loopback server fails with `EADDRINUSE` if another process is bound
to `127.0.0.1:53800`. The error surfaces as `Microsoft oauth server
error` in the desktop gate's logger. To free the port:

```bash
# Linux / macOS
lsof -nP -iTCP:53800 -sTCP:LISTEN
# then kill the PID, or
fuser -k 53800/tcp
```

The CLI can use a different port via `MICROSOFT_REDIRECT_URI`. The
desktop and plugin **cannot** — they hardcode the port. Either free
`53800` or rebuild with a different `OAUTH_PORT` constant.

### `Invalid state - potential CSRF attack`

The `state` parameter returned by Microsoft does not match the value
generated when the URL was built. This is a CSRF / race condition
indicator. Common causes:

- A second login attempt was started before the first callback landed
  (the plugin's `waitForOAuthCallback` explicitly supersedes prior
  pending requests, but only in the plugin; the desktop gate's
  `pendingOAuth` is also a single-slot).
- The user opened the authorize URL in a different browser or session
  than the one that received the loopback server. Stay on the same
  machine.
- System clock drift. PKCE does not validate timestamps directly, but
  Microsoft's `state` is opaque; if you are debugging locally, clear
  the loopback server state and retry.

### Admin prompt does not appear (CLI)

The CLI only offers the admin prompt when `process.stdin.isTTY &&
process.stdout.isTTY`. In CI, Docker, or piped contexts it goes straight
to the Microsoft flow. Set `MICROSOFT_LOGIN_BYPASS=1` instead, or attach
a TTY (`script /dev/null -c opencode`, `tmux`, etc.).

### "Microsoft device authorization was denied"

The user clicked **Cancel** on the Microsoft sign-in page during the
device-code flow, or explicitly denied the request. Re-run the login
command and complete the flow.

### "Microsoft device code expired - please re-run login"

The 15-minute device-code window elapsed before the user completed the
flow. Re-run the login command to request a new `user_code`.

### "OAuth callback timeout - authorization took too long"

The user did not complete the browser flow within 5 minutes
(`OAUTH_CALLBACK_TIMEOUT_MS`). The browser tab continues to work, but
the loopback server has already given up. Close the tab, restart the
login, and finish faster.

### Token exchange / refresh failed (HTTP 5xx)

Microsoft returned a non-2xx response on the token endpoint. The error
message includes the body. Common causes:

- AAD outage — retry.
- `refresh_token` was revoked (long idle, admin reset, conditional access
  policy change) — re-run the full login flow. The plugin reports
  `Microsoft token refresh failed (400)` and the loader falls through to
  the next request, which will get a 401 and surface the auth error
  upstream.
- Wrong `client_id` after migration — confirm the env var override and
  the registered app match.

### `window.loginApi` is undefined (desktop login dialog)

The login dialog shows buttons but clicking either "Sign in with Microsoft" or
"Sign in" (admin) throws `Cannot read properties of undefined (reading
'startMicrosoftOAuth')` — or, after the defensive fix, a visible error message
says *"Preload script failed to load"*.

**Likely cause.** The preload script (`out/preload/login.js`) failed to load
inside the packaged app's asar archive. This is silent unless the
`preload-error` listener is present.

**Diagnosis.**

1. Check `electron-log` output for `login dialog preload failed`. The entry
   includes the resolved `preloadPath`, the `packaged` flag, and the exact
   error message.
2. The log entry is written by the `preload-error` listener on the login
   `BrowserWindow`, added in July 2026.
3. If no preload-error log appears but `loginApi` is still undefined, the
   preload script may be loading successfully but `contextBridge` may be
   failing silently (rare Electron/Chromium bug).

**Resolution.** Restart the application. If the error persists, ensure the
`out/preload/login.js` file is bundled in the asar (it should be included by
the `out/**/*` glob in the `files` config of `electron-builder.config.ts`).

**July 2026 fix.** The login HTML was switched from `data:text/html` to a
temp file loaded via `win.loadFile()` because `data:` URLs + preload scripts
are unreliable in packaged Electron 42 on Windows. If you still see this
error after the fix, open an issue with the electron-log output.

### Clearing state for a fresh start

```bash
rm -f ~/.local/share/opencode/auth.json
# or, on macOS:
rm -f "$HOME/Library/Application Support/opencode/auth.json"
```

This forces the gate to re-prompt on the next launch.

---

## See also

- `packages/desktop/AGENTS.md` — desktop packaging and renderer conventions.
- `packages/opencode/AGENTS.md` — opencode package conventions, database
  notes, and Effect rules.
- Microsoft identity platform v2.0 reference:
  <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>
- RFC 7636 (PKCE) and RFC 8628 (device authorization grant).
