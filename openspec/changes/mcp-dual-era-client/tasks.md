# Tasks — MCP Dual-Era Client Support

## Phase A: Client package migration (3 tasks)

- [x] Add `@modelcontextprotocol/client@2.0.0` alongside the existing `@modelcontextprotocol/sdk@1.29.0`; do not remove v1 yet. #deps #A1 #s
  - File: `packages/opencode/package.json`
  - Validation: `bun install && bun run typecheck` in `packages/opencode`
  - Note: `bun install` resolved cleanly (`@modelcontextprotocol+client@2.0.0` + its `@modelcontextprotocol+core@2.0.0` dep in `node_modules/.bun`). Verified the package's `.d.mts` actually exports `versionNegotiation`, `PriorDiscovery`, and `ConnectOptions.prior` as described in the release notes this proposal cites — not assumed. `bun run typecheck` still fails, but only on the pre-existing `src/session/prompt.ts:1152` error that predates this task and is caused by uncommitted WIP elsewhere in the working tree (bisected separately, see `mcp-dual-era-client` push history) — nothing this task touched regressed.

- [ ] Port `createClient`/`connectRemote`/`connectLocal` in `packages/opencode/src/mcp/index.ts` to the v2 `Client`, preserving StreamableHTTP → SSE → stdio fallback order and existing OAuth flow. #client #A2 #l
  - File: `packages/opencode/src/mcp/index.ts`
  - Validation: existing MCP connection integration tests pass unchanged against at least one legacy (pre-2026-07-28) fixture server

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
