# MCP Dual-Era Client Support

## Why

The MCP spec revision 2026-07-28 removes the `initialize`/session handshake
entirely, makes the protocol stateless, and requires a new `server/discover`
RPC for version and capability advertisement (see
[changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).
Almost every MCP server we connect to today — including our own `skein` and,
for one more revision, `homeops-mcp` — still speaks pre-2026-07-28. Pinning
opencode-skein's client to the modern wire format would break those
connections outright.

Today the MCP client (`packages/opencode/src/mcp/index.ts`) is on
`@modelcontextprotocol/sdk@1.29.0`, the legacy v1 TypeScript package. The
dual-era negotiation capability we need does **not** exist as a flag on
that package — it ships in a separate, newer package,
`@modelcontextprotocol/client@2.0.0` (released alongside the 2026-07-28
spec), which exposes a `versionNegotiation` client option and a
`PriorDiscovery` cache (`{kind:"modern", discover}` / `{kind:"legacy"}`) so
a known-legacy server skips the `server/discover` probe on every
reconnect. So this is a package migration, not a version bump.

Separately — and arguably higher-value than the protocol work itself —
every tool a connected server exposes currently reaches the model
unfiltered, namespaced only as `{server}_{tool}`. `skein` alone already
exposes ~43 tools this way (see companion change in the `skein` repo,
`mcp-tool-surface-redesign`). There is no allowlist or profile mechanism
in `MCP.tools()` (`packages/opencode/src/mcp/index.ts:633`) to narrow that
before it enters context. Protocol modernization does not fix this by
itself — it needs its own config surface, and this is the natural place to
add it since opencode-skein is the one client every server flows through.

## What

1. **Migrate the MCP client from `@modelcontextprotocol/sdk` v1 to
   `@modelcontextprotocol/client` v2** in `packages/opencode/src/mcp/`,
   preserving today's transport fallback behavior (StreamableHTTP → SSE →
   stdio).
2. **Add a `protocolMode` setting**, global and per-server
   (`legacy` / `auto` / `modern`), backed by v2's `versionNegotiation`
   option. Default `auto` everywhere; `modern` is opt-in only (mainly for
   test fixtures), matching how badly a modern-only default would break
   existing servers.
3. **Cache negotiation verdicts** per server using `PriorDiscovery` so a
   known-legacy server (e.g. `skein`, until it upgrades) does not pay a
   `server/discover` probe on every reconnect.
4. **Add a protocol/capability diagnostic** surfaced alongside the existing
   `Status` union in `packages/opencode/src/mcp/index.ts` — era (legacy/
   modern), negotiated protocol version, transport, and capabilities —
   visible via `opencode mcp` CLI output and any status UI that reads
   `MCP.status()`.
5. **Add per-server tool allowlists/profiles** (`mcpToolProfiles` config,
   keyed by server) filtering `MCP.tools()` before tool defs reach the
   model — independent of protocol era, this is what actually solves the
   "48 tools in context" problem.

## Non-goals

- Does not touch `skein`'s or `homeops-mcp`'s server-side protocol version —
  those are tracked in their own repos (`mcp-tool-surface-redesign` in
  `skein`; a bd dependency-watch item in `homeops-mcp-research`).
- Does not attempt to adopt MRTR, `subscriptions/listen`, or other
  2026-07-28 features that only matter once a *modern* server is on the
  other end — out of scope until at least one real server (likely
  `homeops-mcp`, once its upstream Python SDK ships) is actually modern.
