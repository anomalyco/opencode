# SYN-001: AI Memory

Key decisions, gotchas, and context for AI continuity.

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Plugin-only approach (no core code changes) | Fork-local constraint: "keep every local change small and in low-churn files so `git fetch upstream && git merge upstream/dev` stays clean" | 2026-07-18 |
| Use Synapse Coder staging facade (not prod) | Validate integration before prod; staging is the sanctioned testing surface | 2026-07-18 |
| Opt-in default off | Privacy: no code leaves the machine without explicit user consent | 2026-07-18 |
| One-sided corrections for LSP diagnostics | The next-turn fix is not available in the `tool.execute.after` hook; Synapse may accept one-sided reports with `reason` containing the diagnostics | 2026-07-18 |
| `chat.message` hook for model tracking | The `tool.execute.after` hook doesn't receive the model ID directly; `chat.message` (`packages/plugin/src/index.ts:234-243`) carries `model: { providerID, modelID }` (optional) and can populate a per-session map | 2026-07-18 |
| Signal 2 (permission rejection) DEFERRED to Phase 2 | Plan review found `permission.v2.replied` event doesn't carry feedback text (`packages/schema/src/permission.ts:44-51`); `tool.execute.after` doesn't fire on errors (`packages/opencode/src/session/tools.ts:111`). Not feasible without core changes | 2026-07-18 |
| Bearer token syntax: `{env:VAR}` not `${VAR}` | Plan review found opencode uses `{env:VAR}` substitution (`packages/opencode/src/config/variable.ts:36`), not shell-style `${VAR}` | 2026-07-18 |
| Plugin at `.opencode/plugin/` not `packages/` | Plan review: `.opencode/plugin/` is outside `packages/` — zero merge risk with upstream; auto-discovered via `packages/opencode/src/config/plugin.ts:18-30` | 2026-07-18 |
| Pairing redesign: hold failing edits, report only when a same-file follow-up edit lands clean | E2E found the live `coder_report_correction` schema requires `tool`, `model`, and **non-empty** `original`/`corrected` (`additionalProperties: false`) — one-sided reports are rejected. Placeholder `corrected` values would pollute the learning corpus, so detection and reporting are decoupled | 2026-07-19 |
| Env-var opt-in gate instead of config schema key | `synapse_coder.enabled` would require a core config schema change (fork-local violation). `SYNAPSE_CODER_REPORTER_ENABLED` (default off) + first-use TUI toast with once-per-project marker `.opencode/synapse-coder-prompted` satisfies AC-006/AC-010 without core changes | 2026-07-19 |

## Gotchas

| Gotcha | Impact | Mitigation |
|--------|--------|-----------|
| opencode does NOT use `.mcp.json` — it uses `opencode.json` → `mcp` key | MCP config won't load if put in `.mcp.json` | Use `opencode.json`; evidence: `packages/core/src/v1/config/config.ts:113-115`, `packages/opencode/src/cli/cmd/mcp.ts:394-410` |
| Bearer token syntax is `{env:VAR}` NOT `${VAR}` | Auth fails with 401 if wrong syntax used | Use `Bearer {env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}`; evidence: `packages/opencode/src/config/variable.ts:36` (regex `/\{env:([^}]+)\}/g`) |
| `permission.v2.replied` event doesn't carry feedback text | Signal 2 (permission rejection) is infeasible without core changes | Deferred to Phase 2; evidence: `packages/schema/src/permission.ts:44-51` (schema has only `sessionID`, `requestID`, `reply`) |
| `tool.execute.after` doesn't fire when tool throws | CorrectedError (permission rejection) prevents the hook trigger from running | Signal 2 deferred; evidence: `packages/opencode/src/session/tools.ts:111` (generator fails before reaching trigger at line 121) |
| `chat.message` hook `model` field is optional | `reporterModel` may be undefined when user doesn't specify a model | Fallback: query `client.session.get(sessionID)` or default to `"unknown"`; evidence: `packages/plugin/src/index.ts:238` (`model?:`) |
| TUI event is `tui.toast.show` not `TuiEvent.ToastShow` | Event type names are lowercase dot-notation, not PascalCase | Use `client.tui.showToast()`; evidence: `packages/schema/src/tui-event.ts:40-41` |
| `edit.ts` discards the pre-format LLM literal output after `format.file()` runs | Can't capture "LLM proposed X, formatter corrected to Y" pair without core changes | Documented as Phase 2 (deferred); the `tool.execute.after` hook still has `input.args.newString` as the original |
| `experimental_repairToolCall` is not plugin-hookable | Can't capture malformed-tool-call corrections without core changes | Documented as Phase 2 (deferred) |
| v2 plugin system is in progress but not wired into live session loop | v1 hooks are stable for now, but may be deprecated when v2 lands | Monitor v2 progress; plugin can be migrated when v2 lands |
| The `write.ts` tool does NOT return `diff` in metadata (only in the permission ask) | Asymmetry vs `edit.ts` for diff extraction | Use `input.args.content` as the original for write tool |
| Bearer token must come from vault, not hardcoded | `WEBSTA-001-SECRETS-MANAGEMENT` violation if committed | Use `${SYNAPSE_CODER_STAGING_BEARER_TOKEN}` env var in `opencode.json`; resolve from vault `synapse-coder-mcp-staging-bearer-token` |
| **Live `coder_report_correction` schema differs from docs** | Payloads matching the global agent doc are rejected with MCP -32602 | Required: `tool`, `model`, `original`, `corrected` (all minLength 1). Optional: `reason`, `reporterModel`, `category` (kebab), `severity`, `language`, `taskFamily`, `checkPattern`. `additionalProperties: false`. Verify with live `tools/list` before changing the payload builder |
| `mcp list` shows "connected" but that does not validate tool argument schemas | A green MCP connection can still hide a broken payload contract | Always E2E the actual `tools/call` — unit tests with mocked fetch cannot catch schema drift (ISS-001) |
| Local MCP config shape is `command: string[]` + `environment` + `enabled`, not `command`+`args`+`env` | Config validation fails at startup (`packages/core/src/v1/config/mcp.ts:6-23`) | See ISS-004 |
| `bun test` on Windows intermittently reports "beforeEach/afterEach hook timed out (~30s+)" under load | False-failure noise; single- and multi-file | Environmental, no deterministic repro. Repo test script's `--only-failures` rerun handles it. See `evidence/phase4-e2e-verification.md` |

## Context for Continuation

- **Worktree:** `C:\GitHub\opencode---synapse-coder-reporter` on branch `synapse-coder-reporter`
- **Repo entry check:** Clean on `dev`, no active worktrees (other than this one)
- **Investigation findings:** Full report in `evidence/investigation-findings.md` (delegated to explore agent, task `ses_08af21ebcffej8PIDqksXqeYgs`)
- **Planning skill:** `Skills/Lifecycle/LIF-001-20-planning-create-plan.md` (loaded via RAG)
- **Synapse Coder details:** `C:\GitHub\AGENTS.md` Synapse Coder section; `Reference/AI/Capabilities/KB-AI-016-MCP-Server-Reference.md`
- **opencode version:** 1.18.3
