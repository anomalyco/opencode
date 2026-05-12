# ADR-001: Native MCP headersHelper for dynamic authentication headers

## Status
Proposed

## Context
OpenCode currently supports static headers for remote MCP servers via `mcp.<name>.headers`, and those headers are passed into the MCP SDK transport at transport construction time. Research established that Claude Code supports a `headersHelper` setting with the following semantics:

- `headersHelper: string`
- executed in a shell
- 10 second timeout
- invoked when the MCP connection is created and again on reconnect
- no caching between connections
- stdout must be a JSON object of headers
- helper-produced headers override static `headers`

This feature is attractive because many MCP servers use short-lived bearer tokens, gateway-signed headers, or environment-derived credentials that cannot be represented safely or ergonomically as static config.

However, exact Claude compatibility would also make OpenCode execute arbitrary shell strings from configuration. In OpenCode, project config is routinely loaded as part of opening a workspace. That turns an MCP configuration field into a code-execution surface with platform-specific quoting behavior, hard-to-audit provenance, and a meaningful trust boundary expansion.

The local codebase also already favors structured config schemas and explicit child-process execution:

- remote MCP config is defined in `packages/opencode/src/config/mcp.ts`
- remote transports are created in `packages/opencode/src/mcp/index.ts`
- CLI and HTTP API expose MCP config and status flows
- generated schema / SDK artifacts will need to reflect any config contract change

The design question is therefore not whether dynamic headers are useful, but whether OpenCode should copy Claude's unsafe config shape exactly or preserve only the operational semantics while choosing a safer contract.

## Options Considered
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| A. Exact Claude compatibility: `headersHelper: string` executed by shell | Easiest migration from Claude configs; identical docs semantics; lowest cognitive friction for users switching tools | Arbitrary shell execution from config; quoting/injection risk; OS-specific behavior; weak validation; difficult to reason about trust; surprising code execution on workspace open; harder to test deterministically | ✗ |
| B. OpenCode-specific structured helper: `headersHelper` as structured command config, no shell | Preserves dynamic auth use case while reducing injection risk; portable argv semantics; fits existing schema and Effect process APIs; easier validation, logging, and testing | Not drop-in compatible with Claude config; users must translate existing helper strings or wrap them in scripts | ✓ |
| C. Support both exact string and structured forms | Best migration story; can claim compatibility while introducing safer path | Keeps the unsafe form permanently alive; documentation and support burden doubles; users and examples will drift toward the insecure shortcut | ✗ |
| D. Do nothing and require static headers only | Simplest implementation; no new trust surface | Fails the real short-lived credential use case; pushes users toward wrappers, proxies, or plugins; does not solve the target problem | ✗ |

## Decision
OpenCode should add **native dynamic MCP header support as a safer OpenCode-specific variant**, not Claude-compatible shell-string execution.

The chosen v1 design intentionally preserves the useful runtime semantics Claude established while rejecting the unsafe config shape:

- helper is evaluated **per connection and per reconnect**
- helper output is **not cached** across connections in v1
- helper stdout must be a **JSON object of string headers**
- helper-produced headers **override** static `headers`
- default helper timeout is **10 seconds**
- execution uses a **structured argv command**, not a shell string

Recommended config shape for v1:

```json
{
  "mcp": {
    "example": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": {
        "x-client": "opencode"
      },
      "headersHelper": {
        "command": ["node", "./scripts/mcp-headers.js"],
        "environment": {
          "PROFILE": "prod"
        },
        "timeout": 10000
      }
    }
  }
}
```

This is a deliberate compatibility break from Claude-style `headersHelper: string`. Users who have an existing shell snippet must move that logic into a script or executable and reference it as an argv array.

### Architecture Overview
```text
opencode.json
   |
   v
Config schema (`config/mcp.ts`)
   |
   v
MCP service (`mcp/index.ts`)
   |
   +--> resolve static headers
   +--> execute headersHelper command (10s default, no shell)
   +--> parse JSON stdout -> header map
   +--> merge: static headers <- helper headers
   |
   v
StreamableHTTP/SSE transport construction
   |
   v
MCP connect / reconnect lifecycle
```

### Data Flow
1. OpenCode loads MCP config and validates `headersHelper` as structured command metadata.
2. When connecting a remote MCP server, OpenCode resolves static `headers` first.
3. Immediately before transport construction, OpenCode executes the helper command with no shell.
4. OpenCode reads stdout, parses it as JSON, and validates `Record<string, string>`.
5. OpenCode merges headers so helper values win on key conflicts.
6. OpenCode constructs the HTTP or SSE transport with the merged headers.
7. On disconnect/reconnect, OpenCode reruns the helper and repeats the merge.
8. Failures surface as MCP connection failures with explicit helper error context; header values themselves must be redacted from logs.

### Key Interfaces
**Config contract**

```ts
type McpHeadersHelper = {
  command: string[]
  environment?: Record<string, string>
  timeout?: number // default 10000
}

type McpRemoteConfig = {
  type: "remote"
  url: string
  headers?: Record<string, string>
  headersHelper?: McpHeadersHelper
  oauth?: McpOAuthConfig | false
  timeout?: number
}
```

**Runtime contract**
- input: remote MCP config
- output: merged request headers used to create `StreamableHTTPClientTransport` or `SSEClientTransport`
- precedence: `headersHelper` output overrides `headers`
- lifecycle: run on connect and reconnect only, not per tool call or per HTTP request
- failure mode: invalid command, non-zero exit, timeout, invalid JSON, or non-string header values fail the connection attempt

## Consequences

### Benefits
- Solves the real dynamic authentication problem for remote MCP servers.
- Keeps the important Claude lifecycle semantics that affect correctness.
- Avoids raw shell evaluation from config and therefore reduces injection and quoting risk.
- Produces a portable and testable contract that fits OpenCode's existing schema-driven architecture.
- Makes future policy controls possible, such as trust prompts or per-workspace execution permissions.

### Tradeoffs
- OpenCode will **not** be copy-paste compatible with Claude configs that use `headersHelper: string`.
- Users must package shell snippets as scripts or executables.
- Some advanced shell behaviors become intentionally out of scope unless users invoke a shell explicitly from `command`, e.g. `['sh', '-lc', '...']`; that remains a conscious user choice rather than a default execution model.
- v1 keeps no cache, so reconnect storms can re-run expensive helpers repeatedly.

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Users expect exact Claude config compatibility and are surprised by the structured form | High | Medium | Document the incompatibility clearly; provide migration examples from shell string to script path/argv |
| Project config can still execute local programs and exfiltrate credentials if trusted blindly | High | High | Treat `headersHelper` as a code-execution surface; gate via existing trust model or add explicit permissioning; redact outputs from logs |
| Helper timeout is too short for some identity systems | Medium | Medium | Default to 10s for predictable behavior; allow per-helper override |
| Reconnect-triggered reruns cause load or rate-limit pressure on auth backends | Medium | Medium | Keep semantics explicit; consider optional caching/TTL only in a later ADR |
| Merge precedence hides static header mistakes | Low | Medium | Document precedence and show effective-header diagnostics without exposing secret values |
| OAuth and headersHelper interactions become confusing for remote servers that support both | Medium | Medium | Define v1 precedence and limits clearly; test both paths; keep advanced composition out of scope |

## Implementation Notes
- Touch points are expected in `packages/opencode/src/config/mcp.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/cli/cmd/mcp.ts`, and generated schema / SDK artifacts.
- Use existing structured config schema patterns for the new `headersHelper` object.
- Use OpenCode's child-process facilities rather than ad hoc shell execution.
- Parse helper stdout strictly as JSON object with string values only.
- Redact helper-derived header values in logs, errors, telemetry, and debug output.
- Ensure helper execution happens at the same lifecycle point for both `StreamableHTTPClientTransport` and `SSEClientTransport`.
- Add tests for:
  - successful helper execution
  - helper timeout
  - invalid JSON
  - non-zero exit
  - precedence over static headers
  - rerun on reconnect with no cache reuse
  - disabled / missing helper behavior

### In Scope for v1
- Remote MCP only
- Structured `headersHelper` config object
- Per connection / reconnect execution
- No cache between connections
- 10s default timeout with optional override
- Helper output overrides static headers
- Schema, CLI, transport, and test coverage updates

### Out of Scope for v1
- Exact Claude `headersHelper: string` compatibility
- Shell-specific parsing or quoting behavior as a first-class contract
- Per-request or per-tool-call header refresh
- Built-in token caching, TTLs, or refresh daemons
- Secret storage or secure enclave integration
- UI workflows for authoring helpers
- Automatic migration of existing Claude configs

## Questions for User
- [NEEDS USER INPUT]: Should `headersHelper` be allowed in project-local config by default, or should this require an explicit trust/permission gate beyond today's normal config loading behavior? This changes the default security posture.
- [NEEDS USER INPUT]: If OpenCode already has, or plans to add, a workspace trust model, should helper execution be blocked until the workspace is trusted, or should global config remain the only unrestricted source?
- [NEEDS USER INPUT]: Do we need a documented migration guide from Claude's `headersHelper: string` to OpenCode's structured command form in the same change set, or can that ship immediately after core support?
