# Tasks — MCP Dual-Era Client Support

## Phase A: Client package migration (3 tasks)

- [x] Add `@modelcontextprotocol/client@2.0.0` alongside the existing `@modelcontextprotocol/sdk@1.29.0`; do not remove v1 yet. #deps #A1 #s
  - File: `packages/opencode/package.json`
  - Validation: `bun install && bun run typecheck` in `packages/opencode`
  - Note: `bun install` resolved cleanly (`@modelcontextprotocol+client@2.0.0` + its `@modelcontextprotocol+core@2.0.0` dep in `node_modules/.bun`). Verified the package's `.d.mts` actually exports `versionNegotiation`, `PriorDiscovery`, and `ConnectOptions.prior` as described in the release notes this proposal cites — not assumed. `bun run typecheck` still fails, but only on the pre-existing `src/session/prompt.ts:1152` error that predates this task and is caused by uncommitted WIP elsewhere in the working tree (bisected separately, see `mcp-dual-era-client` push history) — nothing this task touched regressed.

- [x] Port `createClient`/`connectRemote`/`connectLocal` in `packages/opencode/src/mcp/index.ts` to the v2 `Client`, preserving StreamableHTTP → SSE → stdio fallback order and existing OAuth flow. #client #A2 #l
  - File: `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/mcp/catalog.ts`, `packages/opencode/src/mcp/oauth-provider.ts`, `packages/opencode/package.json` (added `@modelcontextprotocol/core` — needed for the Zod schema *values* `ToolSchema`/`ListToolsResultSchema` that `catalog.ts`'s tolerant-list-tools workaround extends/omits; the plain inferred TS types `MCPToolDef`/`LoggingMessageNotification` come from `@modelcontextprotocol/client` directly, which re-exports both schema values under `core` and plain types itself — corrected during A3's audit, see A3 notes)
  - Verified against the installed package's own `.d.mts` rather than assumed: **`SSEClientTransport` is NOT removed in v2** (only deprecated, still exported from the package root) — the SDK's own doc example literally shows a StreamableHTTP-then-SSE-fallback pattern identical to this codebase's existing one, so the fallback chain ports unchanged. `StdioClientTransport` moved to the `@modelcontextprotocol/client/stdio` subpath. `setRequestHandler`/`setNotificationHandler` now key off method strings (`'roots/list'`, `'notifications/message'`, `'notifications/tools/list_changed'`) instead of Zod schema objects — ported directly, no behavior change. `transport.finishAuth(authorizationCode)` (bare string) still compiles via an overload, so the OAuth callback flow needed no changes; `OAuthClientProvider`'s new SEP-2352 methods (`discoveryState`/`saveDiscoveryState`) are optional, so `McpOAuthProvider` satisfies the interface unchanged (adopting them is a follow-up, not required for this port). `client.callTool()`'s 3-arg schema-validation overload is gone in v2 (result type now comes from the built-in method→type map) — dropped the redundant `CallToolResultSchema` argument in `catalog.ts`.
  - Found and fixed one real type regression surfaced by the port: `serverLog`'s switch over log levels was only exhaustive against v1's narrower level type; v2 widened it, leaking an implicit `undefined` return. Added a `default` branch (logs at info level rather than silently dropping).
  - Validation: `bun run typecheck` clean except the same pre-existing unrelated `prompt.ts:1152` error. `test/server/httpapi-mcp.test.ts` (5/5 pass) and `test/server/httpapi-mcp-oauth.test.ts` exercise real `connect`/`disconnect`/OAuth-endpoint paths through the ported code via a local stdio fixture server. `test/cli/mcp-add.test.ts`'s 2 failures are pre-existing and unrelated — reproduced identically with this change fully stashed out.
  - No compatibility fixture server (legacy vs. modern) exists yet to prove real dual-era negotiation end-to-end — that's Phase D, not yet done. This task ports the *code path*; it does not yet prove auto-negotiation against a live legacy server, since `versionNegotiation`/`protocolMode` config (Phase B) isn't wired in yet — v2's `connect()` with no options defaults to some negotiation mode, unverified which.

- [x] Remove `@modelcontextprotocol/sdk` v1 once nothing imports it. #deps #A3 #s
  - File: `packages/opencode/package.json`, root `package.json` (dropped the now-orphaned `@modelcontextprotocol/sdk@1.29.0` patch entry and deleted the patch file), `packages/opencode/src/cli/cmd/mcp.ts` (the one remaining `src/` importer, out of A2's stated scope — ported here)
  - Simplified A2's `catalog.ts`/`index.ts` imports while auditing: `Tool`/`LoggingMessageNotification` plain types come directly from `@modelcontextprotocol/client`'s own barrel (it re-exports both the Zod schema values *and* plain inferred types) — the `z.infer` derivation A2 used was unnecessary complexity from checking only `@modelcontextprotocol/core` (schema-values-only) and missing that `client` has the plain types too.
  - **Scope grew substantially beyond the stated validation criterion.** `grep -r "@modelcontextprotocol/sdk" packages/opencode/src` passing was not sufficient: `packages/opencode/test/mcp/` (8 files, 2142 lines) and `test/fixture/mcp-session-recovery.ts` also imported v1, and would have hard-failed on module resolution once the package was removed. Ported all of them.
  - **Found and fixed a real, previously-undiagnosed test infrastructure bug** while doing this, confirmed pre-existing and unrelated to any SDK version (reproduced identically on unmodified `dev`): `test/mcp/{headers,lifecycle,oauth-auto-connect,oauth-browser}.test.ts` all called `mock.module(id, factory)` without awaiting it (`void mock.module(...)`) despite the API's own type signature declaring `void | Promise<void>` — combined with a second, more significant issue, this meant `mock.module` never actually intercepted the module by the time the code under test dynamically imported it, so every test relying on the mocked `Client`/transport classes silently exercised unmocked (or partially-broken) real code instead. Fixed by (a) awaiting every `mock.module()` call and (b) — the fix that actually mattered — consolidating each file's separate per-subpath mocks (`.../streamableHttp.js`, `.../sse.js`, `.../auth.js`, `.../index.js`) into one mock of the single `@modelcontextprotocol/client` package v2 consolidates them into, spreading the real module's exports first so anything not explicitly overridden (e.g. `Client` in a file only meaning to mock transports) doesn't silently disappear. Result: `test/mcp/` went from 26 pass / 34 fail (pre-existing, confirmed via git-stash bisection) to 59 pass / 1 skip / 0 fail.
  - The 1 skip (`test/mcp/session-recovery.test.ts`) is not a bug — it tests session-ID-based reconnection (`Mcp-Session-Id` header, re-`initialize`-on-404), a feature the 2026-07-28 spec removes entirely (SEP-2567: no more protocol-level sessions). v2's real client confirms this: a 404 on a session-bound POST now throws `SdkHttpError(CLIENT_HTTP_NOT_IMPLEMENTED)` instead of reinitializing. Skipped with a comment explaining why, not deleted.
  - Explicitly did NOT attempt: a full DI-based or real-fixture-server rewrite of this test suite's mocking architecture. The bug found and fixed was `mock.module` usage — a mechanical, low-risk fix. A deeper architectural change to how these ~30 scenarios are tested was assessed as substantially larger, higher-risk work appropriate for separate, deliberate scoping, not a tail-end fix in this change.
  - Validation: `bun run typecheck` clean except the same pre-existing unrelated `prompt.ts:1152` error (confirmed still present after `bun install`). `grep -rl "@modelcontextprotocol/sdk" packages/opencode/src packages/opencode/test` returns only a comment, no imports. `grep -rl "@modelcontextprotocol/sdk" packages/*/package.json` returns nothing — no other workspace package depends on it (it remains physically present in `node_modules` only via an unrelated third-party package's own transitive dependency, outside this repo's control). `bun test test/mcp/` 59 pass / 1 skip / 0 fail; `bun test test/server/httpapi-mcp.test.ts test/server/httpapi-mcp-oauth.test.ts` 6/6 pass.

## Phase B: Protocol mode + diagnostics (3 tasks)

- [ ] Add `protocolMode` config (`legacy`/`auto`/`modern`), global default + per-server override, wired to v2's `versionNegotiation` option. #config #B1 #m
  - File: `packages/opencode/src/mcp/index.ts`, config schema (`ConfigMCPV1`)
  - Validation: unit test asserting each mode produces the expected `versionNegotiation` value passed to `Client`

- [ ] Cache negotiation verdicts per server via `PriorDiscovery`, keyed by server name, persisted across reconnects within a session. #client #B2 #m
  - File: `packages/opencode/src/mcp/index.ts`
  - Validation: integration test — reconnecting a known-legacy server does not re-issue `server/discover`

- [ ] Extend the `Status` union (or add a sibling `Diagnostics` type) with era, negotiated protocol version, transport, capabilities; surface in `opencode mcp` CLI. #diagnostics #B3 #m
  - File: `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/cli/cmd/mcp.ts`
  - Validation: `opencode mcp` output includes era/protocol/capabilities columns, verified against a running legacy and a running modern fixture server

## Phase C: Per-server tool allowlists (2 tasks)

- [ ] Add `mcpToolProfiles` config (named tool-name lists) and a per-server `toolProfile` reference; filter `MCP.tools()` before defs are handed to the model. #tools #C1 #m
  - File: `packages/opencode/src/mcp/index.ts` (`tools` function, ~line 633), config schema
  - Validation: unit test — a server with a configured profile only yields the allowlisted tool keys from `MCP.tools()`

- [ ] Document `protocolMode` and `mcpToolProfiles` in config docs/schema. #docs #C2 #s
  - File: `packages/opencode/src/config/config.ts` schema comments or `packages/docs`
  - Validation: `openspec validate mcp-dual-era-client --strict` (schema/docs consistency)

## Phase D: Compatibility fixtures (2 tasks, blocks Phase B/C validation)

- [ ] Build a legacy-only and a dual-era MCP test fixture server (stdio) for CI. #fixtures #D1 #m
  - File: new `packages/opencode/test/fixtures/mcp-legacy`, `mcp-dual-era`
  - Validation: both fixtures pass a basic `tools/list` + `tools/call` round trip under the existing test runner

- [ ] Verify reconnect/fallback behavior against both fixtures plus one real legacy server (`skein`, pre-upgrade). #fixtures #D2 #m
  - Validation: manual `opencode mcp` run against `skein` shows `era: legacy`, connects and lists tools successfully
