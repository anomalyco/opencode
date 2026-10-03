# OpenCode Proxy Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all outbound OpenCode HTTP authenticate to a corporate proxy using Negotiate (Kerberos/SPNEGO), NTLM, or Basic, so the `curl/*` User-Agent workaround is no longer needed.

**Architecture:** A new `Proxy` capability in `@opencode-ai/core` resolves proxy settings (config → URL userinfo → env) and builds an auth-capable undici `Dispatcher` with a custom CONNECT + `407` challenge/response loop. Three pluggable auth providers (Negotiate, NTLM, Basic) sit behind one interface; Negotiate/NTLM come from one optional native addon. The dispatcher is injected once at the shared `httpClient` node so every consumer inherits it.

**Tech Stack:** TypeScript on Bun, Effect (`effect/unstable/http`), undici `Dispatcher`, napi-rs (Rust) for the optional native addon (Windows SSPI, macOS/Linux GSSAPI), `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-02-opencode-proxy-authentication-design.md`

## Execution Environment (this machine)

The reporting machine sits behind the authenticating corporate gateway, which shapes how
tests run locally. Recorded so an executor can reproduce:

- Bun is pinned to `1.3.14` (root `packageManager`). Install locally, not system-wide.
- The gateway intercepts TLS and gates some hosts on `User-Agent` (see the spec).
  `packages/app` depends on `github:anomalyco/ghostty-web`, fetched from
  `codeload.github.com`, which returns **403** for non-`curl/*` UAs (Bun). This is
  the exact bug being fixed. For local work, install filtered to the packages
  under test, e.g. `bun install --filter "@opencode-ai/core"`, and temporarily
  drop the `ghostty-web` dependency from `packages/app` (restore before
  finalizing). `codeload` is not needed for `core` or `opencode`.
- Bun needs the corporate root/intermediate CAs (`NODE_EXTRA_CA_CERTS`), or
  `NODE_TLS_REJECT_UNAUTHORIZED=0` for local-only installs.
- The repo forbids running tests from the root (`bunfig.toml` guard); run from
  `packages/core`.

## Global Constraints

- Mechanisms: Negotiate (Kerberos/SPNEGO), NTLM fallback, Basic. Selection order for `auth: "auto"` is **Negotiate → NTLM → Basic**.
- Platforms: Windows, macOS, Linux.
- One optional native addon, lazily imported. OpenCode must install and run without it; Negotiate/NTLM degrade, Basic still works.
- Coverage: all outbound HTTP (provider/model calls, `webfetch`/`websearch`, `models.opencode.ai`, OAuth/token, plugin/skill fetches, update checks, MCP-over-HTTP). Local loopback is always direct.
- Config: auto-discovery by default, explicit `opencode.json` overrides allowed. Config keys use **snake_case** (`no_proxy`), matching `ConfigV2.*`.
- `password` supports `{env:VAR}` substitution. Credentials and `Proxy-Authorization` must never be logged.
- Handshake rounds are bounded; auth per proxy is serialized with `KeyedMutex`.
- No new mandatory environment variables.

## Review Focus

The input classes and failure modes most likely to bite a user, each pinned to a test in the task that owns the code:

1. `no_proxy`/`NO_PROXY` with wildcards, ports, CIDR-less hostnames, and IPv6 `::1` — expect a direct connection, never a tunnel. (Task 2)
2. Proxy requires auth but the native addon is unavailable — expect an actionable error or Basic fallback, never a hang or a bare `407`. (Tasks 9, 12)
3. Kerberos ticket expires during a long session — expect transparent re-auth on the next request, not a permanent failure. (Task 11)
4. Concurrent cold-start requests through one proxy — expect exactly one challenge handshake, not one per request. (Task 5)
5. Credentials or `Proxy-Authorization` values leaking into logs or error text — expect redaction. (Task 8)

---

## File Structure

- `packages/core/src/config/proxy.ts` — `ConfigProxy.Info` schema. New.
- `packages/core/src/config.ts` — register `proxy` in `Config.Info`. Modify.
- `packages/core/src/proxy/resolve.ts` — precedence + bypass decision. New.
- `packages/core/src/proxy/auth/provider.ts` — provider interface + `selectProviders`. New.
- `packages/core/src/proxy/auth/basic.ts` — Basic provider. New.
- `packages/core/src/proxy/auth/negotiate.ts` — Negotiate provider. New.
- `packages/core/src/proxy/auth/ntlm.ts` — NTLM provider. New.
- `packages/core/src/proxy/native.ts` — lazy loader + `ProxyAuthNative` interface. New.
- `packages/core/src/proxy/dispatcher.ts` — `makeDispatcher`, CONNECT + `407` loop. New.
- `packages/core/src/proxy/error.ts` — `ProxyAuthError`. New.
- `packages/core/src/proxy/index.ts` — Effect service/layer + `httpClientLayer`. New.
- `packages/core/src/effect/app-node-platform.ts` — inject proxy-aware client. Modify.
- `packages/core/test/proxy/fake-proxy.ts` — local authenticating-proxy harness. New.
- `packages/core/test/proxy/*.test.ts` — unit + integration tests. New.
- `packages/proxy-auth-native/` — the optional addon package. New.
- `packages/web/src/content/docs/network.mdx`, `config.mdx`, `troubleshooting.mdx` — docs. Modify.

---

### Task 1: Resolve the Effect HTTP seam (probe)

**Files:**
- Modify: `packages/core/src/effect/app-node-platform.ts`
- Test: `packages/core/test/proxy/seam.test.ts`

**Interfaces:**
- Produces: a decision on how a custom `fetch`/dispatcher is supplied to the shared client, recorded in `packages/core/src/proxy/index.ts` as `export const httpClientLayer`.

- [ ] **Step 1: Write the probe test**

```ts
// packages/core/test/proxy/seam.test.ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"

// A fetch that never touches the network, to prove the seam replaces global fetch.
test("shared http client uses the injected fetch", async () => {
  let calls = 0
  const fakeFetch = (async () => { calls++; return new Response("ok") }) as typeof fetch
  const client = /* candidate construction under test */
  await Effect.runPromise(client.execute(HttpClient.request.get("https://example.invalid/")) as any)
  expect(calls).toBe(1)
})
```

- [ ] **Step 2: Run it and record which construction compiles**

Run: `bun test packages/core/test/proxy/seam.test.ts`
Expected: fail because the candidate construction is unset. Determine, against the installed `effect` version, which of these works and note it in `packages/core/src/proxy/index.ts`:
  1. `FetchHttpClient.make(fakeFetch)` (preferred if it exists),
  2. `HttpClient.make(fakeFetch)` from `effect/unstable/http`,
  3. if neither takes a fetch, keep `FetchHttpClient.layer` and set the runtime dispatcher/global fetch around node construction (record why in a comment).

- [ ] **Step 3: Record the chosen seam**

Add to `packages/core/src/proxy/index.ts`:

```ts
// Chosen seam (Task 1): <exact constructor>, because <one line>.
```

- [ ] **Step 4: Re-run the probe until it passes**

Run: `bun test packages/core/test/proxy/seam.test.ts`
Expected: PASS (`calls === 1`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/proxy/seam.test.ts packages/core/src/proxy/index.ts
git commit -m "spike(core): determine http client fetch seam for proxy dispatcher"
```

---

### Task 2: Proxy config schema and resolution

**Files:**
- Create: `packages/core/src/config/proxy.ts`
- Modify: `packages/core/src/config.ts`
- Create: `packages/core/src/proxy/resolve.ts`
- Test: `packages/core/test/proxy/resolve.test.ts`

**Interfaces:**
- Produces:
  - `ConfigProxy.Info` (Schema class) with optional `url`, `auth`, `username`, `password`, `no_proxy`.
  - `resolve(input: { config?: ConfigProxy.Info; env?: Record<string,string|undefined>; target: string | URL }): ProxySettings`
  - `interface ProxySettings { url?: URL; auth: "auto"|"negotiate"|"ntlm"|"basic"|"none"; username?: string; password?: string; no_proxy?: string }`
  - `isLoopback(host: string): boolean` (true for `localhost`, `127.0.0.0/8`, `::1`, `[::1]`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/proxy/resolve.test.ts
import { test, expect } from "bun:test"
import { resolve, isLoopback } from "../../src/proxy/resolve"

test("config url wins over env", () => {
  const s = resolve({ config: { url: "http://cfg:8080" } as any, env: { HTTPS_PROXY: "http://env:8080" }, target: "https://a.test/" })
  expect(s.url?.host).toBe("cfg:8080")
})
test("env is used when config is absent", () => {
  const s = resolve({ env: { HTTPS_PROXY: "http://env:8080" }, target: "https://a.test/" })
  expect(s.url?.host).toBe("env:8080")
})
test("no_proxy wildcard and port entries force direct", () => {
  expect(resolve({ env: { HTTPS_PROXY: "http://p:8080", NO_PROXY: "*.test,other:443" }, target: "https://a.test/" }).url).toBeUndefined()
  expect(resolve({ env: { HTTPS_PROXY: "http://p:8080", NO_PROXY: "other:443" }, target: "https://a.other/" }).url).toBeDefined()
})
test("loopback is always direct", () => {
  expect(isLoopback("127.0.0.1")).toBe(true)
  expect(isLoopback("::1")).toBe(true)
  expect(isLoopback("[" + "::1" + "]")).toBe(true)
  expect(resolve({ env: { HTTPS_PROXY: "http://p:8080" }, target: "http://127.0.0.1:9000/" }).url).toBeUndefined()
})
test("url userinfo becomes username/password", () => {
  const s = resolve({ env: { HTTPS_PROXY: "http://u:p@proxy:8080" }, target: "https://a.test/" })
  expect(s.username).toBe("u"); expect(s.password).toBe("p")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/core/test/proxy/resolve.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `config/proxy.ts` following the `ConfigV2.*` pattern (see `config/watcher.ts`); snake_case keys, `auth` as `Schema.Literals([...])`. Register `proxy: ConfigProxy.Info.pipe(Schema.optional)` in `Config.Info` in `config.ts` (import alongside the other `ConfigXxx`). Implement `resolve` reusing `shouldProxy` semantics from `packages/opencode/src/util/proxy-env.ts` (move/copy the pure helper into core so core has no dependency on the opencode package). Precedence: config → URL userinfo → env → none; loopback always direct.

- [ ] **Step 4: Run to verify pass**

Run: `bun test packages/core/test/proxy/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/proxy.ts packages/core/src/config.ts packages/core/src/proxy/resolve.ts packages/core/test/proxy/resolve.test.ts
git commit -m "feat(core): add proxy config schema and resolution"
```

---

### Task 3: Auth provider interface and Basic provider

**Files:**
- Create: `packages/core/src/proxy/auth/provider.ts`
- Create: `packages/core/src/proxy/auth/basic.ts`
- Test: `packages/core/test/proxy/basic.test.ts`

**Interfaces:**
- Produces:
  - `interface ProxyAuthContext { proxy: URL; target: string; username?: string; password?: string }`
  - `interface ProxyAuthProvider { scheme: "negotiate"|"ntlm"|"basic"; step(ctx: ProxyAuthContext, challenge: string): Promise<string | undefined> }`
  - `selectProviders(auth: ProxySettings["auth"], challenged: readonly string[]): readonly ProxyAuthProvider[]`
  - `basic: ProxyAuthProvider` and `basicHeader(user, pass): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/proxy/basic.test.ts
import { test, expect } from "bun:test"
import { basic, basicHeader } from "../../src/proxy/auth/basic"
import { selectProviders } from "../../src/proxy/auth/provider"

test("basic header encodes credentials", () => {
  expect(basicHeader("u", "p")).toBe("Basic " + Buffer.from("u:p").toString("base64"))
})
test("selectProviders honors auto order", () => {
  expect(selectProviders("auto", ["NTLM", "Negotiate", "Basic"]).map((p) => p.scheme)).toEqual(["negotiate", "ntlm", "basic"])
})
test("explicit mechanism narrows selection", () => {
  expect(selectProviders("basic", ["Negotiate", "Basic"]).map((p) => p.scheme)).toEqual(["basic"])
  expect(selectProviders("none", ["Negotiate", "Basic"])).toEqual([])
})
test("basic step returns undefined when no credentials", async () => {
  expect(await basic.step({ proxy: new URL("http://p:8080"), target: "https://a/" }, "Basic realm=\"p\"")).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure** — `bun test packages/core/test/proxy/basic.test.ts`; expected FAIL.

- [ ] **Step 3: Implement** `provider.ts` (interface + `selectProviders` mapping challenge tokens to `scheme`s, order fixed by `auto`) and `basic.ts`.

- [ ] **Step 4: Run to verify pass** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/auth/provider.ts packages/core/src/proxy/auth/basic.ts packages/core/test/proxy/basic.test.ts
git commit -m "feat(core): add proxy auth provider interface and basic auth"
```

---

### Task 4: Fake authenticating-proxy test harness

**Files:**
- Create: `packages/core/test/proxy/fake-proxy.ts`
- Test: `packages/core/test/proxy/fake-proxy.test.ts`

**Interfaces:**
- Produces: `startFakeProxy(opts: { schemes: ("Negotiate"|"NTLM"|"Basic")[]; accept: (scheme: string, header: string) => boolean }): Promise<{ url: URL; requests: string[]; close(): Promise<void> }>`. It is an HTTP server that answers `CONNECT` with `407` + `Proxy-Authenticate: <schemes>` until an accepted `Proxy-Authorization` arrives, then `200`, then tunnels. Records each `Proxy-Authorization` (value only, for assertions).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test"
import { startFakeProxy } from "./fake-proxy"
test("fake proxy challenges then accepts", async () => {
  const p = await startFakeProxy({ schemes: ["Basic"], accept: (s, h) => h.startsWith("Basic ") })
  const res = await fetch("http://example.test/", { proxy: p.url.toString() } as any).catch(() => undefined)
  expect(p.requests.length).toBeGreaterThan(0)
  await p.close()
})
```

- [ ] **Step 2: Run to verify failure** — expected FAIL (harness missing).

- [ ] **Step 3: Implement** the harness with Bun's `Bun.serve`/`node:http`, handling `connect` events and plain requests, emitting challenges and recording headers.

- [ ] **Step 4: Run to verify pass** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/proxy/fake-proxy.ts packages/core/test/proxy/fake-proxy.test.ts
git commit -m "test(core): add fake authenticating-proxy harness"
```

---

### Task 5: Proxy dispatcher with the 407 challenge/response loop

**Files:**
- Create: `packages/core/src/proxy/dispatcher.ts`
- Test: `packages/core/test/proxy/dispatcher.test.ts`

**Interfaces:**
- Consumes: `resolve`/`ProxySettings` (Task 2), `selectProviders`/`basic` (Task 3), the harness (Task 4).
- Produces: `makeDispatcher(settings: ProxySettings, deps?: { providers?: readonly ProxyAuthProvider[]; native?: ProxyNative }): Dispatcher` (`Dispatcher` = undici's). Guarantees: bounded rounds (`MAX_AUTH_ROUNDS = 3`), per-proxy serialization via `KeyedMutex.make()`, tunnel cache keyed by `${proxy.origin}->${target}`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test"
import { makeDispatcher } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

test("authenticates a CONNECT tunnel via Basic then reuses it", async () => {
  const p = await startFakeProxy({ schemes: ["Basic"], accept: (s, h) => h.startsWith("Basic ") })
  const d = makeDispatcher({ url: p.url, auth: "basic", username: "u", password: "p" })
  // two requests to the same origin over the dispatcher; second must not re-handshake
  // assert p.requests.length === 1 after both complete
  await p.close()
})
test("cap rounds when the proxy keeps challenging", async () => {
  const p = await startFakeProxy({ schemes: ["Basic"], accept: () => false })
  const d = makeDispatcher({ url: p.url, auth: "basic", username: "u", password: "p" })
  // expect a bounded number of Proxy-Authorization attempts (<= MAX_AUTH_ROUNDS)
  await p.close()
})
```

- [ ] **Step 2: Run to verify failure** — expected FAIL.

- [ ] **Step 3: Implement** `makeDispatcher`: subclass undici `Agent` with a custom `connect`, send `CONNECT`, on `407` parse `Proxy-Authenticate`, run providers in order, retry, cache the authenticated tunnel, wrap the auth sequence in `withLock(proxy.origin)`. Attach `Proxy-Authorization` for plain-HTTP via `dispatch`.

- [ ] **Step 4: Run to verify pass** — expected PASS; assert single handshake and bounded rounds.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/dispatcher.ts packages/core/test/proxy/dispatcher.test.ts
git commit -m "feat(core): proxy dispatcher with CONNECT 407 challenge/response loop"
```

---

### Task 6: Inject the dispatcher at the shared HTTP client

**Files:**
- Create: `packages/core/src/proxy/index.ts` (fill in)
- Modify: `packages/core/src/effect/app-node-platform.ts`
- Test: `packages/core/test/proxy/integration.test.ts`

**Interfaces:**
- Consumes: Task 1 seam, `resolve` (Task 2), `makeDispatcher` (Task 5).
- Produces: `Proxy.Service` (Effect) exposing `settings` and `dispatcher`; `httpClientLayer` used by `app-node-platform.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { httpClientLayer } from "../../src/proxy"
import { startFakeProxy } from "./fake-proxy"

test("shared client proxies and authenticates", async () => {
  const p = await startFakeProxy({ schemes: ["Basic"], accept: (s, h) => h.startsWith("Basic ") })
  process.env.HTTPS_PROXY = p.url.toString()
  process.env.PROXY_USERNAME = "u"; process.env.PROXY_PASSWORD = "p"
  const client = await Effect.runPromise(Effect.provide(HttpClient.HttpClient, httpClientLayer))
  const res = await Effect.runPromise(client.execute(HttpClient.request.get("https://opencode.invalid/")) as any)
  expect(res.status).toBeGreaterThan(0)
  await p.close()
})
```

- [ ] **Step 2: Run to verify failure** — expected FAIL.

- [ ] **Step 3: Implement** `index.ts` `httpClientLayer` from the chosen seam, resolving settings from `Config` + env and building the dispatcher; point `app-node-platform.ts`'s `httpClient` node at it.

- [ ] **Step 4: Run to verify pass** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/index.ts packages/core/src/effect/app-node-platform.ts packages/core/test/proxy/integration.test.ts
git commit -m "feat(core): inject proxy-aware dispatcher into shared http client"
```

---

### Task 7: Loopback bypass and no-proxy behavior end to end

**Files:**
- Test: `packages/core/test/proxy/bypass.test.ts`

**Interfaces:** Consumes Task 6's `httpClientLayer`.

- [ ] **Step 1: Write the failing test** — with `HTTPS_PROXY` pointing at a fake proxy and a target of `http://127.0.0.1:<local>`, assert the local server receives the request directly and the fake proxy records nothing.
- [ ] **Step 2: Run to verify failure** — expected FAIL if bypass not honored.
- [ ] **Step 3: Fix** any direct-vs-proxy decision in `resolve`/layer so loopback and `no_proxy` targets never reach the dispatcher.
- [ ] **Step 4: Run to verify pass** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(core): ensure loopback and no_proxy targets bypass the proxy"`

---

### Task 8: Actionable errors and redaction

**Files:**
- Create: `packages/core/src/proxy/error.ts`
- Modify: `packages/core/src/proxy/dispatcher.ts`, `packages/core/src/proxy/index.ts`
- Test: `packages/core/test/proxy/error.test.ts`

**Interfaces:**
- Produces: `class ProxyAuthError extends Error` with a stable `kind: "no-credentials" | "rejected" | "missing-native" | "rounds-exceeded"` and a message template per the spec §7.

- [ ] **Step 1: Write the failing tests**

```ts
test("no-credentials error names the mechanism and suggests a fix", () => {
  const e = new ProxyAuthError("no-credentials", { proxy: "http://p:8080" })
  expect(e.message).toContain("Negotiate/NTLM/Basic")
})
test("credentials never appear in error text or logs", () => {
  const e = new ProxyAuthError("rejected", { proxy: "http://u:secret@proxy:8080" } as any)
  expect(e.message).not.toContain("secret")
  expect(JSON.stringify(e, Object.getOwnPropertyNames(e))).not.toContain("secret")
})
```

- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** `ProxyAuthError` and throw the right `kind` from the dispatcher/layer; scrub URLs of userinfo in messages and in any debug log.
- [ ] **Step 4: Run to verify pass** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): actionable, redacted proxy auth errors"`

---

### Task 9: Optional native addon package and lazy loader

**Files:**
- Create: `packages/proxy-auth-native/package.json`, `packages/proxy-auth-native/src/index.ts`, `packages/proxy-auth-native/native/` (Rust/napi-rs), `packages/proxy-auth-native/README.md`
- Create: `packages/core/src/proxy/native.ts`
- Test: `packages/core/test/proxy/native-loader.test.ts`

**Interfaces:**
- Produces: `interface ProxyAuthNative { negotiate(spn: string): Promise<Uint8Array>; ntlm: { createType1(domain?: string, workstation?: string): Uint8Array; createType3(type2: Uint8Array, username: string, password: string, domain?: string): Uint8Array } }`; `load(): Promise<ProxyAuthNative | undefined>` (never throws; returns `undefined` when absent).

- [ ] **Step 1: Write the failing test** — `load()` resolves `undefined` when the module is not installed, and does not throw.
- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** the addon package (napi-rs; Windows SSPI via the `sspi` crate, macOS/Linux GSSAPI via `libgssapi`) exposing the interface above, and `native.ts` lazy `import("@opencode-ai/proxy-auth-native")` in a `try/catch`.
- [ ] **Step 4: Run to verify pass** — expected PASS with the addon absent.
- [ ] **Step 5: Commit** — `git commit -m "feat(proxy-auth-native): optional native addon scaffold and lazy loader"`

---

### Task 10: Negotiate (Kerberos/SPNEGO) provider

**Files:**
- Create: `packages/core/src/proxy/auth/negotiate.ts`
- Test: `packages/core/test/proxy/negotiate.test.ts`
- Test (gated): `packages/proxy-auth-native/test/negotiate.test.ts`

**Interfaces:** Consumes `ProxyAuthNative.negotiate`; produces `negotiate(native: ProxyAuthNative): ProxyAuthProvider` emitting `Negotiate <base64(token)>`, SPN `HTTP/<proxy-host>`.

- [ ] **Step 1: Write the failing unit test** — with a stub native returning fixed bytes, `step` returns `Negotiate <base64>`; on the second call with a completed context it returns a final token; with no tickets it returns `undefined`.
- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** the provider.
- [ ] **Step 4: Run to verify pass** — expected PASS. Add the addon-gated round-trip test behind `PROXY_NATIVE_E2E=1` so CI without Kerberos skips it.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): negotiate (kerberos/spnego) proxy auth provider"`

---

### Task 11: NTLM provider and transparent re-auth

**Files:**
- Create: `packages/core/src/proxy/auth/ntlm.ts`
- Modify: `packages/core/src/proxy/dispatcher.ts` (re-auth on mid-session 407)
- Test: `packages/core/test/proxy/ntlm.test.ts`, `packages/core/test/proxy/reauth.test.ts`

**Interfaces:** Consumes `ProxyAuthNative.ntlm`; produces `ntlm(native: ProxyAuthNative): ProxyAuthProvider` implementing Type1 → Type3; dispatcher re-handshakes on a subsequent `407` (e.g. ticket expiry) rather than reusing a dead tunnel.

- [ ] **Step 1: Write failing tests**:
  - NTLM `step` emits `NTLM <base64(type1)>` then `NTLM <base64(type3)>` given a Type2 challenge.
  - Re-auth: fake proxy accepts the first tunnel, then invalidates it (forces `407`) on the next request; assert the client transparently re-authenticates and succeeds.
- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** the provider and dispatcher re-auth path (invalidate cache entry on `407`, re-run handshake under the lock).
- [ ] **Step 4: Run to verify pass** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): ntlm provider and transparent tunnel re-auth"`

---

### Task 12: Error-message integration, packaging, and docs

**Files:**
- Modify: `packages/core/package.json`, `packages/proxy-auth-native/package.json`, root `package.json`
- Modify: `packages/web/src/content/docs/network.mdx`, `config.mdx`, `troubleshooting.mdx`
- Test: `packages/core/test/proxy/no-native.test.ts`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Write the failing test** — with `auth: "negotiate"` and the addon absent, expect a `ProxyAuthError` `kind: "missing-native"`; with `auth: "auto"` and no tickets, expect Basic fallback or `kind: "no-credentials"`, never a hang.
- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** the fallback/error wiring; add the addon as `optionalDependencies` with prebuilds (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64` glibc/musl); document the `proxy` config, an enterprise proxy-auth section, and a `407` troubleshooting entry that names the User-Agent-keyed gateway anti-pattern.
- [ ] **Step 4: Run to verify pass** — expected PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/core packages/proxy-auth-native packages/web/src/content/docs package.json
git commit -m "feat: package optional proxy auth addon; document proxy configuration"
```

---

### Task 13: Verify against the reporting machine's gateway

**Files:**
- Modify: `proxy-verification.md` (append results)

- [ ] **Step 1: Run the `webfetch` matrix** with the new build and Negotiate enabled against the corporate gateway.
- [ ] **Step 2: Confirm** `https://opencode.ai/` and `https://models.opencode.ai/api.json` return `200`, and that `packages/core` logs no further `models.dev` `407`.
- [ ] **Step 3: Record** the before/after table in `proxy-verification.md`.
- [ ] **Step 4: Commit** — `git commit -m "docs: verify proxy auth against the corporate gateway"`

---

## Self-Review

**1. Spec coverage:** §4.1 Proxy service → Tasks 2,5,6; §4.2 providers → Tasks 3,10,11 and addon Task 9; §4.3 injection → Tasks 1,6; §5 flow → Tasks 5,7,11; §6 config/creds → Tasks 2,12; §7 errors → Tasks 8,12; §8 testing → harness Task 4 used throughout, gated native tests Tasks 9–11; §9 packaging/docs → Task 12; machine verification → Task 13. No gaps.

**2. Step scan:** Each step is one action with a checkable result. Bodies are signatures and test assertions, not transcripts.

**3. Type consistency:** `ProxySettings`, `ProxyAuthProvider`, `ProxyAuthNative`, `selectProviders`, `makeDispatcher`, `resolve`, `ProxyAuthError` kinds, and `httpClientLayer` are named identically across tasks.

**4. Review Focus:** Each of the five items maps to a task test (bypass → Task 2/7; missing native → Tasks 9/12; ticket expiry re-auth → Task 11; single handshake → Task 5; redaction → Task 8).

**5. Proportion:** The plan is comparable in length to the spec and defers code bodies to implementers.
