# SYN-001: Requirements

## Goal

Feed opencode's code-correction events into Synapse Coder's `coder_report_correction` learning loop, so corrections observed during opencode sessions grow the shared lesson corpus and improve future AI coding assistance across Alterspective.

## Explicit Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| R-001 | The integration must not require core code changes (fork-local constraint) | `AGENTS.md` fork-local note |
| R-002 | User consent is required before any code is sent to Synapse (privacy) | `AIMETH-010`, `WEBSTA-001-SECRETS-MANAGEMENT` |
| R-003 | The integration must degrade gracefully when Synapse is unreachable (resilience) | `WEBSTA-001-ERROR-HANDLING-STANDARDS` |
| R-004 | The integration must report LSP diagnostics after edits (Signal 1). Permission rejection detection (Signal 2) is deferred to Phase 2 — the `permission.v2.replied` event doesn't carry feedback text and `tool.execute.after` doesn't fire on errors | Investigation findings + plan review |
| R-005 | The integration must use the Synapse Coder MCP staging facade (not prod) until validated | `AGENTS.md` Synapse Coder section |

## Assumptions (with evidence)

| # | Assumption | Evidence |
|---|------------|----------|
| A-001 | Synapse Coder staging facade is accessible at `https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp` | `C:\GitHub\AGENTS.md` Synapse Coder section |
| A-002 | Bearer token is in vault secret `synapse-coder-mcp-staging-bearer-token` | `C:\GitHub\AGENTS.md` Synapse Coder section |
| A-003 | opencode v1 plugin hooks are stable and won't break before v2 lands | Investigation: v2 is "in progress" (`packages/plugin/src/v2/effect/`) but not wired into the live session loop; v1 `Hooks` interface is live |
| A-004 | The `coder_report_correction` MCP tool accepts parameters: `reporterModel`, `category`, `language`, `original`, `corrected`, `reason` | `C:\GitHub\AGENTS.md` Synapse Coder section |
| A-005 | opencode's `opencode.json` `mcp` key supports remote HTTP servers with headers | Investigation: `packages/core/src/v1/config/mcp.ts:1`, `ConfigMCPV1.Info` has `type`, `url`, `headers` |
| A-006 | The `tool.execute.after` plugin hook receives `output.metadata` including `diagnostics` | Investigation: `packages/plugin/src/index.ts:274-281`, `packages/opencode/src/tool/edit.ts:203-208` |
| A-007 | The `chat.message` plugin hook carries `model: { providerID, modelID }` for `reporterModel` — but the field is OPTIONAL (`packages/plugin/src/index.ts:238` — `model?`). Fallback: query `client.session.get(sessionID)` or default to `"unknown"` | Investigation + plan review |

## VISION.md

**Status:** Absent. The opencode repository does not have a `VISION.md` file (verified: `Test-Path C:\GitHub\opencode\VISION.md` returned `False`). This is not required for a fork-local integration plugin — the opencode project is an upstream fork with its own product direction, and this feature is an Alterspective-specific add-on that does not alter the product's vision. The fork-local `AGENTS.md` note governs scope.

## Routed Standards

| Standard | Rule IDs | Application |
|----------|----------|-------------|
| `WEBSTA-001-SECRETS-MANAGEMENT` | `SEC-001` | No committed plaintext credentials; use vault refs for the bearer token |
| `WEBSTA-001-TESTING-STANDARDS` | `TST-VAL-*` | Validation claims must cite exact checks performed |
| `WEBSTA-001-ERROR-HANDLING-STANDARDS` | `ERR-*` | Graceful degradation when MCP unreachable |
| `MCP-STANDARDS` | `MCP-*` | opencode.json mcp config guidance (not `.mcp.json` — opencode uses its own config) |
| `AIMETH-005` | — | Git worktree discipline (worktree created) |
| `AIMETH-010` | — | Evidence-based verification |

## Non-Functional Requirements

| NFR | Target |
|-----|--------|
| Performance | Plugin hooks must not block the tool execution loop; reports fire async (fire-and-forget) |
| Privacy | No code leaves the machine without explicit user opt-in; per-session confirmation for first report |
| Reliability | Offline queue with retry; no crash if Synapse is unreachable |
| Fork-local | Zero changes to high-churn core files (`edit.ts`, `write.ts`, `llm.ts`, `processor.ts`) |
| Observability | Structured logging of what's sent; user-visible indicator when a report fires |
