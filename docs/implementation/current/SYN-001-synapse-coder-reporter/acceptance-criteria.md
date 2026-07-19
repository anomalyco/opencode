# SYN-001: Acceptance Criteria

## Functional Acceptance Criteria

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-001 | Synapse Coder MCP server is configured in `opencode.json` and connects on opencode startup | `opencode mcp list` shows `synapse-coder` with status `connected`; `coder_report_correction` appears in tool list |
| AC-002 | The `synapse-coder-reporter` plugin loads without errors | opencode startup log shows plugin loaded; no console errors |
| AC-003 | When the LLM uses `edit`/`write`/`apply_patch` and LSP reports diagnostics, the plugin detects the correction | Structured log: `{ event: "correction_detected", signal: "lsp_diagnostics", file, category: "lsp-typecheck" }` |
| AC-004 | (DEFERRED) Permission rejection detection — Phase 2 | N/A in Phase 1 |
| AC-005 | When opt-in is enabled, the plugin calls `coder_report_correction` with the correct payload | Synapse Coder staging logs show the report; payload matches: `reporterModel`, `category`, `language`, `original`, `corrected`, `reason` |
| AC-006 | When opt-in is disabled (default), no code is sent to Synapse | No network calls to Synapse; structured log: `{ event: "correction_detected", reported: false, reason: "opt_in_disabled" }` |
| AC-007 | When Synapse Coder is unreachable, the plugin queues the report and does not crash | Offline queue file `.opencode/synapse-coder-queue.json` has pending entries; opencode continues normally |
| AC-008 | The `reporterModel` field is correctly populated with the current model ID | Report payload shows `reporterModel: "anthropic/claude-sonnet-4-5"` (or current model) |
| AC-009 | The `language` field is correctly derived from the file extension | Report payload shows `language: "typescript"` for `.ts` files, `language: "python"` for `.py` files |
| AC-010 | First-use opt-in prompt appears when a correction is first detected | TUI toast: "Synapse Coder learning loop detected a correction. Enable reporting?" |

## Non-Functional Acceptance Criteria

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| NAC-001 | Plugin hook overhead is < 5ms per tool call (non-blocking) | Benchmark: time `tool.execute.after` hook with and without plugin; measure with `performance.now()` |
| NAC-002 | No core code changes (fork-local compliance) | `git diff dev..synapse-coder-reporter -- packages/opencode/src/tool/ packages/opencode/src/session/ packages/opencode/src/lsp/` returns empty |
| NAC-003 | No committed plaintext credentials | `grep -r "Bearer" opencode.json` returns only `{env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}` env var reference (opencode's `{env:VAR}` syntax, not `${VAR}`) |
| NAC-004 | All tests pass (`bun test` from `packages/opencode`) | Test run output: all green, 0 failures |
| NAC-005 | TypeScript checks pass (`bun typecheck` from `packages/opencode`) | Typecheck output: 0 errors |

## Test Scenarios

| Scenario | Steps | Expected |
|----------|-------|----------|
| TS-001: LSP diagnostics after edit | 1. Enable opt-in<br>2. Ask LLM to edit a `.ts` file with a type error<br>3. LSP reports diagnostics | Plugin detects correction; `coder_report_correction` called with `category: "lsp-typecheck"`, `language: "typescript"` |
| TS-002: Permission rejection (DEFERRED) | Deferred to Phase 2 — not feasible in Phase 1 | N/A |
| TS-003: Opt-in disabled | 1. Disable opt-in<br>2. Trigger LSP diagnostics | No network call to Synapse; correction logged as `reported: false` |
| TS-004: Synapse unreachable | 1. Enable opt-in<br>2. Block the Synapse URL (or use invalid URL)<br>3. Trigger a correction | Report queued in `.opencode/synapse-coder-queue.json`; opencode continues normally |
| TS-005: Model ID tracking | 1. Switch model to e.g. `openai/gpt-5`<br>2. Trigger a correction | `reporterModel: "openai/gpt-5"` in the report payload |
| TS-006: Language derivation | 1. Edit a `.py` file with a type error<br>2. Check report payload | `language: "python"` |
