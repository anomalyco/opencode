# SYN-001: Task Checklist

## Phase 1: Foundation & MCP Wiring

| Task | Description | Agent | Deliverable | Verification |
|------|-------------|-------|-------------|--------------|
| 1.1 | Add Synapse Coder MCP server config to `opencode.json` (using `{env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}` syntax, NOT `${VAR}`) | Build | `opencode.json` has `mcp.synapse-coder` entry with staging URL and `Bearer {env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}` header | `opencode mcp list` shows `synapse-coder` connected; `coder_report_correction` in tool list |
| 1.2 | Verify MCP tool discovery and plugin hook firing | Build | Evidence file `evidence/phase1-mcp-verification.md` with command output | `coder_report_correction` callable; `tool.execute.after` hook fires on a test edit |

## Phase 2: Correction Detection Plugin

| Task | Description | Agent | Deliverable | Verification |
|------|-------------|-------|-------------|--------------|
| 2.1 | Create plugin scaffold at `.opencode/plugin/synapse-coder-reporter.ts` with `chat.message` hook for model tracking (with fallback to `client.session.get()` or `"unknown"`) | Build | Plugin file at `.opencode/plugin/synapse-coder-reporter.ts` | Plugin loads; model map populated per session |
| 2.2 | Implement `tool.execute.after` hook for LSP diagnostics detection (edit/write/apply_patch) | Build | Hook registered; detection logic for non-empty `metadata.diagnostics` | Structured log on correction detection (TS-001) |
| 2.3 | (DEFERRED to Phase 2) Permission rejection detection — infeasible in Phase 1 (`permission.v2.replied` doesn't carry feedback; `tool.execute.after` doesn't fire on errors) | — | — | — |
| 2.4 | Implement language derivation from file extension | Build | Language map utility; unit tests for all extensions in the map | `language` field correct in report payload (TS-006) |

## Phase 3: Reporting & Consent

| Task | Description | Agent | Deliverable | Verification |
|------|-------------|-------|-------------|--------------|
| 3.1 | Implement reporter module — call `coder_report_correction` MCP tool via opencode client | Build | Reporter function; payload builder with all required fields | Report payload matches schema (AC-005) |
| 3.2 | Implement user opt-in gate (config + first-use TUI toast) | Build | Config schema `synapse_coder.enabled`; `TuiEvent.ToastShow` on first correction | Opt-in disabled by default (AC-006); first-use prompt appears (AC-010) |
| 3.3 | Implement error handling and offline queue | Build | Queue file `.opencode/synapse-coder-queue.json`; retry on plugin load + 5-min timer | Synapse unreachable → queue grows; opencode continues (AC-007, TS-004) |
| 3.4 | Implement async fire-and-forget (non-blocking hooks) | Build | All MCP calls wrapped in `Promise.resolve().then(...)` or equivalent; no `await` in hook path | Hook overhead < 5ms (NAC-001) |

## Phase 4: Testing & Verification

| Task | Description | Agent | Deliverable | Verification |
|------|-------------|-------|-------------|--------------|
| 4.1 | Unit tests for each correction detector + language map | Testing | Test files in `packages/opencode/test/plugin/synapse-coder-reporter/` | All unit tests pass (NAC-004) |
| 4.2 | Integration test — simulate LSP error after edit, verify report fires | Testing | Test file with mock LSP diagnostics; verify MCP tool called | Report payload correct (TS-001) |
| 4.3 | E2E verification — run real opencode session, verify Synapse receives correction | Testing | Evidence file `evidence/phase4-e2e-verification.md` with screenshots/logs | Synapse staging logs show the report (AC-005) |

## Wave Structure

| Wave | Tasks | Type | Review |
|------|-------|------|--------|
| 1 | 1.1, 1.2 | Build + Verify | Review after wave |
| 2 | 2.1, 2.2, 2.4 | Build (parallel) | Review after wave |
| 3 | 3.1, 3.2, 3.3, 3.4 | Build (parallel) | Review after wave |
| 4 | 4.1, 4.2, 4.3 | Testing (parallel) | Review after wave |

Total: 12 tasks (2.3 deferred), 4 waves, 4 review cycles.
