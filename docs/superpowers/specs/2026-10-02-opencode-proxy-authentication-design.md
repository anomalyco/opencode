# OpenCode Proxy Authentication — Design

Date: 2026-10-02
Status: Draft for review
Topic: Authenticating to corporate HTTP proxies (Negotiate/Kerberos, NTLM, Basic) in OpenCode

## 1. Problem

OpenCode cannot complete proxy authentication. On networks whose egress goes
through an authenticating gateway (for example a corporate Secure Web
Gateway), unauthenticated requests receive `407` with
`Proxy-Authenticate: Negotiate / NTLM / Basic`. OpenCode's HTTP stack only
resolves a proxy URL from the environment; it never answers the challenge.

Observed impact on the reporting machine:

- `webfetch` returns `407` for every origin outside a small gateway allow-list
  (`opencode.ai`, `models.opencode.ai`, `example.com`, `www.google.com`, …).
- `models.opencode.ai/api.json` fails every 5 minutes, so model metadata never
  refreshes.
- The only current workaround is a proxy rule that bypasses authentication when
  `User-Agent` starts with `curl/`. Any client can spoof that header, so it is
  not an acceptable control.

## 2. Goal and success criteria

- OpenCode authenticates to an authenticating proxy so all outbound HTTP works
  without a User-Agent workaround.
- Mechanisms: **Negotiate (Kerberos/SPNEGO)**, **NTLM fallback**, **Basic**.
- Platforms: **Windows, macOS, Linux** (full cross-platform).
- Dependencies: **one optional native addon**, lazily loaded; OpenCode still
  installs and runs without it (Basic / explicit credentials remain available).
- Coverage: **all outbound HTTP** — provider/model calls, `webfetch`/`websearch`,
  `models.opencode.ai`, OAuth/token, plugin/skill URL fetches, update checks,
  MCP-over-HTTP. **Local loopback** service traffic is excluded.
- Configuration: **auto-discovery by default, explicit overrides allowed**.

Success on the reporting machine: the `webfetch` matrix returns `200` for
`opencode.ai` and `models.opencode.ai`, and the `models.dev` error stops.

## 3. Current state (evidence from `anomalyco/opencode@dev`)

- Proxy URL resolution already exists: `packages/opencode/src/util/proxy-env.ts`
  (adapted from `proxy-from-env`). It reads `*_proxy` / `no_proxy` and never
  handles authentication.
- All HTTP funnels through one node:
  `packages/core/src/effect/app-node-platform.ts`:
  ```ts
  export const httpClient = makeGlobalNode({
    service: HttpClient.HttpClient,
    layer: FetchHttpClient.layer,
    deps: [],
  })
  ```
  `FetchHttpClient.layer` wraps global `fetch`.
- `webfetch` (`packages/core/src/tool/webfetch.ts`) builds its own request and
  hardcodes a Chrome User-Agent, with a literal `"opencode"` fallback that only
  fires on a Cloudflare `403` challenge. A `407` never triggers it.
- No proxy-authentication code, no `proxy` config section, and no auth-capable
  dependency exist in any manifest.
- undici's stock `ProxyAgent` cannot answer a `407`; the challenge/response loop
  is the core work.

## 4. Architecture

### 4.1 `Proxy` service (in `@opencode-ai/core`)

- **`Proxy.Config`** — new `packages/core/src/config/proxy.ts`, registered in
  `Config.Info` beside the other `ConfigXxx` modules.
- **`Proxy.Dispatcher`** — an undici `Dispatcher` (custom `ProxyAgent` subclass)
  that owns the CONNECT tunnel, the challenge/response loop, and per
  `(proxy, target)` tunnel caching.
- Resolution precedence: explicit config → proxy URL userinfo → env
  (`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`, reusing
  `util/proxy-env.ts`). Loopback is always direct.

### 4.2 Auth providers

One interface, three implementations:

```ts
interface ProxyAuthProvider {
  readonly scheme: "negotiate" | "ntlm" | "basic"
  /** Given the server's Proxy-Authenticate challenge, produce the next
   *  Proxy-Authorization value, or report that it cannot proceed. */
  step(ctx: ProxyAuthContext, challenge: string): Promise<string>
}
```

- **Negotiate (Kerberos/SPNEGO)** and **NTLM** use an optional native addon
  (`ProxyAuthNative`) that abstracts the OS: Windows **SSPI**
  (`AcquireCredentialsHandle` / `InitializeSecurityContext`) and macOS/Linux
  **GSSAPI** (`gss_init_sec_context`, SPNEGO). SPN is `HTTP/<proxy-host>`.
- **Basic** is pure TypeScript, from config / env / URL userinfo.
- `auto` selection reads the proxy's `Proxy-Authenticate` list and tries
  **Negotiate → NTLM → Basic**.
- The addon is imported lazily. If absent, Negotiate/NTLM are disabled and
  `auto` degrades to Basic/explicit credentials with a one-time warning.

### 4.3 Single injection point

The shared `httpClient` node in `packages/core/src/effect/app-node-platform.ts`
becomes a proxy-aware layer built from `Proxy.Dispatcher`. Every consumer —
provider/model calls, `webfetch`/`websearch`, `models.opencode.ai`, OAuth,
plugin/skill fetches, updates, MCP-over-HTTP — resolves the same
`HttpClient.HttpClient` and inherits authenticated proxying with no per-tool
changes.

**Open item to verify in the implementation plan:** the exact Effect API for
supplying a custom `fetch`/dispatcher to `FetchHttpClient` (`FetchHttpClient.layer`
vs a `make(fetch)` form) so the dispatcher is used in both CLI and desktop.

## 5. Authentication flow

### 5.1 Config resolution
Once per location, cached: explicit `proxy` config → URL userinfo → env. Targets
matching `no_proxy`/`proxy.noProxy` or loopback use a **direct** dispatcher.

### 5.2 HTTPS (CONNECT tunnel)
1. Connector sends `CONNECT host:443` to the proxy.
2. Proxy replies `200` → TLS over the socket; or `407` +
   `Proxy-Authenticate`.
3. On `407`: parse schemes, select a provider (`auto` ⇒ Negotiate → NTLM →
   Basic), obtain a `Proxy-Authorization` value, retry the `CONNECT`:
   - **Negotiate:** one SPNEGO token normally completes it.
   - **NTLM:** stateful Type1 → Type3 against the Type2 challenge; connection
     stays alive.
   - **Basic:** `Base64(user:pass)`.
4. Cache the authenticated tunnel per `(proxy, target)`. A mid-session `407`
   (for example Kerberos ticket expiry) triggers transparent re-auth.

### 5.3 Plain HTTP
Same challenge/response loop, with `Proxy-Authorization` attached to the
request instead of a tunnel.

### 5.4 Concurrency and lifecycle
- Auth per proxy is serialized with the existing `keyed-mutex` to avoid
  competing handshakes under concurrent requests.
- Handshake rounds are capped; no infinite loops.
- One `Dispatcher` per location, created at the shared `httpClient` node and
  disposed with the location.

## 6. Configuration and credentials

```jsonc
{
  "proxy": {
    "url": "http://proxy.example.com:8080",   // optional; else HTTP(S)_PROXY/env
    "auth": "auto",                            // auto | negotiate | ntlm | basic | none
    "username": "DOMAIN\\user",       // optional; overrides URL userinfo
    "password": "{env:PROXY_PASSWORD}",        // optional; env substitution
    "noProxy": ["localhost", "127.0.0.1", ".example.com"]
  }
}
```

Precedence (highest → lowest):
1. `proxy.*` in project/global `opencode.json`
2. proxy URL userinfo
3. env (`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY`)
4. OS defaults **for auth only** — Windows SSPI cache, macOS/Linux Kerberos
   ticket cache. No interactive prompt by default.

Behavior of `auth`:
- `auto` (default): OS ticket cache via the addon; if unavailable, fall back to
  Basic with configured credentials; if none, emit an actionable error.
- `none`: send no `Proxy-Authorization` at all. Credentials are ignored; the
  proxy must permit the target (for example an allow-listed destination or an
  unauthenticated proxy). Used to force the pre-existing behavior.

Security:
- `password` supports `{env:VAR}`; docs prefer env/OS cache over inline secrets.
- Credentials and `Proxy-Authorization` are never logged.
- `proxy` is added to the config schema for editor validation.

No new mandatory environment variables: a machine already configured for
curl/browser proxy auth works with zero OpenCode config. `NO_PROXY` reuses
`shouldProxy`; `proxy.noProxy` merges with the env value; loopback is direct.

## 7. Error handling

- **No proxy auth available:** "Proxy requires authentication
  (Negotiate/NTLM/Basic). Configure `proxy` or run `kinit`."
- **Addon missing for an explicit `negotiate`/`ntlm`:** hard error; for `auto`,
  warn once and fall back.
- **Credentials rejected** (persistent `407`): clear message, no retry storm.
- **Ticket expiry mid-session:** transparent re-auth; on failure surface once.
- Bounded handshake rounds; existing per-request timeout preserved.
- Credentials and `Proxy-Authorization` redacted from logs, telemetry, errors.

## 8. Testing

- **Unit:** challenge parsing; `auto` provider-selection order; Basic header;
  NTLM message assembly (pure-TS parts); config precedence; `no_proxy` merging.
- **Integration (no real proxy):** a local fake authenticating proxy returning
  `407` with `Proxy-Authenticate` and accepting canned Negotiate/NTLM/Basic
  responses, following the repo's `http-recorder` / server test patterns.
  Assert: unauthenticated → `407` handled → authenticated `200`; tunnel reuse;
  re-auth on injected expiry; loopback bypass.
- **Native addon:** tests gated behind an env flag so CI without SSPI/GSSAPI/
  Kerberos still passes; token round-trip validated against the fake proxy with
  a test fixture.
- **Regression:** existing tool/provider tests pass unchanged with no proxy
  configured (direct path is the default).

## 9. Packaging and rollout

- One optional package (for example `@opencode-ai/proxy-auth-native`) with
  prebuilds: Windows `win32-x64`, macOS `darwin-arm64`/`x64`, Linux
  `linux-x64` glibc/musl.
- Lazy `import()` so a missing/failed install never breaks startup; declared
  under `optionalDependencies` so Bun/npm skips it cleanly when prebuilds do not
  match.
- **Docs:** `proxy` config reference; an enterprise/proxy-auth page; a
  `troubleshooting` entry for `407`, including the User-Agent-keyed gateway
  anti-pattern.
- **Migration:** fully opt-in; default behavior without proxy settings is
  unchanged.
- **Verification on the reporting machine:** re-run the `webfetch` matrix from
  `proxy-verification.md` against the corporate gateway with Negotiate enabled;
  expect `200` for `opencode.ai` and `models.opencode.ai`, and no further
  `models.dev` errors.

## 10. Suggested implementation decomposition

This is large enough to plan as sequential milestones, each independently
testable and mergeable:

1. **Pure-TS foundation:** `Proxy.Config`, resolution precedence, `Proxy.Dispatcher`
   with the `407` challenge/response loop, the provider interface, **Basic**, and
   the fake-proxy integration tests. Injection at the shared `httpClient` node.
   Delivers a working fix for Basic-auth proxies and all infrastructure.
2. **Native auth:** `@opencode-ai/proxy-auth-native` (SSPI + GSSAPI), the
   **Negotiate** and **NTLM** providers, optional-load/fallback behavior, and
   gated round-trip tests.
3. **Packaging, docs, rollout:** prebuilds, `optionalDependencies`, config/docs,
   and verification against the reporting machine's gateway.

## 11. Out of scope

- PAC / WPAD auto-configuration.
- Interactive credential prompting on `407`.
- Proxying local loopback service traffic.
- SOCKS proxy support (can be a later addition behind the same `Proxy.Dispatcher`).
