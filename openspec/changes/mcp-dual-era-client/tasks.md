# Tasks — MCP Dual-Era Client Support

## Phase A: Client package migration (3 tasks)

- [x] Add `@modelcontextprotocol/client@2.0.0` alongside the existing `@modelcontextprotocol/sdk@1.29.0`; do not remove v1 yet. #deps #A1 #s
  - File: `packages/opencode/package.json`
  - Validation: `bun install && bun run typecheck` in `packages/opencode`
  - Note: `bun install` resolved cleanly (`@modelcontextprotocol+client@2.0.0` + its `@modelcontextprotocol+core@2.0.0` dep in `node_modules/.bun`). Verified the package's `.d.mts` actually exports `versionNegotiation`, `PriorDiscovery`, and `ConnectOptions.prior` as described in the release notes this proposal cites — not assumed. `bun run typecheck` still fails, but only on the pre-existing `src/session/prompt.ts:1152` error that predates this task and is caused by uncommitted WIP elsewhere in the working tree (bisected separately, see `mcp-dual-era-client` push history) — nothing this task touched regressed.

- [x] Port `createClient`/`connectRemote`/`connectLocal` in `packages/opencode/src/mcp/index.ts` to the v2 `Client`, preserving StreamableHTTP → SSE → stdio fallback order and existing OAuth flow. #client #A2 #l
  - File: `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/mcp/catalog.ts`, `packages/opencode/src/mcp/oauth-provider.ts`, `packages/opencode/package.json` (added `@modelcontextprotocol/core` — needed explicitly for `ToolSchema`/`LoggingMessageNotificationSchema`; v2 only re-exports Zod schema *values*, not the plain inferred TS types v1 exported directly, so `MCPToolDef`/`LoggingMessageNotification` are now derived locally via `z.infer<typeof ...Schema>`)
  - Verified against the installed package's own `.d.mts` rather than assumed: **`SSEClientTransport` is NOT removed in v2** (only deprecated, still exported from the package root) — the SDK's own doc example literally shows a StreamableHTTP-then-SSE-fallback pattern identical to this codebase's existing one, so the fallback chain ports unchanged. `StdioClientTransport` moved to the `@modelcontextprotocol/client/stdio` subpath. `setRequestHandler`/`setNotificationHandler` now key off method strings (`'roots/list'`, `'notifications/message'`, `'notifications/tools/list_changed'`) instead of Zod schema objects — ported directly, no behavior change. `transport.finishAuth(authorizationCode)` (bare string) still compiles via an overload, so the OAuth callback flow needed no changes; `OAuthClientProvider`'s new SEP-2352 methods (`discoveryState`/`saveDiscoveryState`) are optional, so `McpOAuthProvider` satisfies the interface unchanged (adopting them is a follow-up, not required for this port). `client.callTool()`'s 3-arg schema-validation overload is gone in v2 (result type now comes from the built-in method→type map) — dropped the redundant `CallToolResultSchema` argument in `catalog.ts`.
  - Found and fixed one real type regression surfaced by the port: `serverLog`'s switch over log levels was only exhaustive against v1's narrower level type; v2 widened it, leaking an implicit `undefined` return. Added a `default` branch (logs at info level rather than silently dropping).
  - Validation: `bun run typecheck` clean except the same pre-existing unrelated `prompt.ts:1152` error. `test/server/httpapi-mcp.test.ts` (5/5 pass) and `test/server/httpapi-mcp-oauth.test.ts` exercise real `connect`/`disconnect`/OAuth-endpoint paths through the ported code via a local stdio fixture server. `test/cli/mcp-add.test.ts`'s 2 failures are pre-existing and unrelated — reproduced identically with this change fully stashed out.
  - No compatibility fixture server (legacy vs. modern) exists yet to prove real dual-era negotiation end-to-end — that's Phase D, not yet done. This task ports the *code path*; it does not yet prove auto-negotiation against a live legacy server, since `versionNegotiation`/`protocolMode` config (Phase B) isn't wired in yet — v2's `connect()` with no options defaults to some negotiation mode, unverified which.

- [ ] Remove `@modelcontextprotocol/sdk` v1 once nothing imports it. #deps #A3 #s
  - File: `packages/opencode/package.json`
  - Validation: `grep -r "@modelcontextprotocol/sdk" packages/opencode/src` returns nothing

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
