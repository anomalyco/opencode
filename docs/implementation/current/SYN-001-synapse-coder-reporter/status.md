# SYN-001: Status

**Last updated:** 2026-07-19
**Phase:** Implementation complete — verified (unit + typecheck + MCP wiring + paired E2E against staging). Awaiting commit decision.
**Branch:** `synapse-coder-reporter`
**Worktree:** `C:\GitHub\opencode---synapse-coder-reporter`

## Current State

All Phase 1 tasks implemented and verified. The E2E run against the real staging
service caught a payload schema mismatch (ISS-001) that unit tests could not —
fixed via a pairing redesign (report only `original`→`corrected` pairs; one-sided
detections are held 30 min then dropped). See `evidence/phase4-e2e-verification.md`.

## Task Status

| Task | Status | Notes |
|------|--------|-------|
| 1.1 — MCP server config | DONE | `synapse-coder` connected via `mcp list`; local-entry shape fixed (ISS-004). Evidence: `evidence/phase1-mcp-verification.md` |
| 1.2 — MCP tool discovery verification | DONE | 12 tools incl. `coder_report_correction`; evidence file written |
| 2.1 — Plugin scaffold + model tracking | DONE | `.opencode/plugin/synapse-coder-reporter.ts` |
| 2.2 — LSP diagnostics detection hook | DONE | Detects non-empty `metadata.diagnostics` on edit/write/apply_patch |
| 2.3 — Permission rejection detection | DEFERRED | Phase 2 — infeasible without core changes (plan review) |
| 2.4 — Language derivation utility | DONE | Extension map; covered by unit tests |
| 3.1 — Reporter module (MCP call) DONE (redesigned) | DONE | Direct JSON-RPC `tools/call`; payload matches live schema (ISS-001) |
| 3.2 — User opt-in gate | DONE (deviation) | Env var gate (default off) + first-use TUI toast, once-per-project marker (ISS-003) |
| 3.3 — Error handling + offline queue | DONE | `.opencode/synapse-coder-queue.json`, retry on load + 5-min timer, flush on dispose |
| 3.4 — Async fire-and-forget | DONE | No `await` on report path; covered by timing test |
| 4.1 — Unit tests | DONE | 28 tests in `test/plugin/synapse-coder-reporter/synapse-coder-reporter.test.ts` |
| 4.2 — Integration tests | DONE | Simulated LSP diagnostics → paired fix → mocked MCP call asserted end-to-end |
| 4.3 — E2E verification | DONE | Real staging accepted paired correction; `coder_stats` evidence (ISS-001 found & fixed) |

## Validation Evidence

- `bun typecheck` from `packages/opencode`: 0 errors (2026-07-19)
- `bun test` (3 new files): 34/34 pass, 4/4 consecutive clean runs (2026-07-19)
- `opencode mcp list`: `synapse-coder connected` (2026-07-19)
- Staging `coder_stats` contains the probe correction (2026-07-19)
- Fork-local: changes confined to `.opencode/`, `docs/`, `packages/opencode/test/` — no `src/` changes
- Known environmental test flake documented in `evidence/phase4-e2e-verification.md`

## Companion Work (same worktree, outside SYN-001 scope)

| Item | Status | Notes |
|------|--------|-------|
| `alterspective-rag-standards` plugin + 6 tests | DONE | System-prompt standards injection (Team A) |
| Health/version sidecar `.opencode/scripts/health-check.ts` + 5 tests | DONE | `/health` + `/version` (Team B; path bug fixed ISS-005) |
| Brand compliance verification | DONE | All compliant, no fixes needed (Team C report) |

## Blockers

None. Next decision: commit strategy for the worktree (SYN-001 work + companion items).
