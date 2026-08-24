## ADDED Requirements

### Requirement: MCP client negotiates protocol era per server
The MCP client SHALL support a `protocolMode` setting with values `legacy`,
`auto`, and `modern`, configurable globally and per-server. The default
SHALL be `auto` for every server unless explicitly overridden.

#### Scenario: default mode does not break a legacy server
- **WHEN** a server is configured with no explicit `protocolMode`
- **THEN** the client uses `auto`, probes via `server/discover`, and falls back to the legacy `initialize` handshake if the probe is unsupported

#### Scenario: modern mode is opt-in only
- **WHEN** no server or global config sets `protocolMode: modern`
- **THEN** no connection is forced onto the strict 2026-07-28 wire format

### Requirement: negotiation verdicts are cached per server
The client SHALL cache the negotiated era (legacy/modern) per server using
`PriorDiscovery` so a known-legacy server does not repeat the
`server/discover` probe on every reconnect within a session.

#### Scenario: reconnect skips re-probing a known-legacy server
- **WHEN** a server has already been negotiated as legacy in the current session
- **THEN** a subsequent reconnect to that server skips the `server/discover` call

### Requirement: protocol/capability diagnostics are visible
The client SHALL expose, per connected server, its negotiated era,
protocol version, transport, and capabilities, surfaced via the `opencode
mcp` CLI and the `MCP.status()` interface.

#### Scenario: diagnostics show era and version
- **WHEN** a user runs `opencode mcp`
- **THEN** the output includes, for each connected server, its era (legacy/modern), negotiated protocol version, and transport

### Requirement: per-server tool visibility can be restricted
The client SHALL support a named `mcpToolProfiles` configuration (lists of
tool names) and a per-server `toolProfile` reference. When a server has a
configured profile, only the listed tools SHALL be included in the tool
definitions passed to the model.

#### Scenario: a profiled server exposes only its allowlisted tools
- **WHEN** a server named `skein` is configured with `toolProfile: "skein-control"` and the profile lists 5 tool names
- **THEN** `MCP.tools()` includes only those 5 tools (namespaced `skein_*`) from that server, regardless of how many tools the server actually advertises

#### Scenario: an unprofiled server is unaffected
- **WHEN** a server has no `toolProfile` configured
- **THEN** all of its advertised tools are included, unchanged from current behavior

#### Scenario: a misconfigured toolProfile fails closed
- **WHEN** a server's `toolProfile` references a name with no matching entry in `mcpToolProfiles`
- **THEN** `MCP.tools()` includes none of that server's tools (not all of them), and a warning is logged
