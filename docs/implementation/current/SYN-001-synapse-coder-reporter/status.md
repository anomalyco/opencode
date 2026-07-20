# SYN-001: Status

**Last updated:** 2026-07-20
**Phase:** MERGED + ACTIVATED. Plugin merged to `dev` via PR #1, canonical-host switch via PR #2. Reporter is live: `SYNAPSE_CODER_REPORTER_ENABLED=true` + staging bearer persisted at User scope; activation probe accepted by Synapse (see below). Related infra/docs: staging canonical host provisioned + global agent file corrected (Alterspective-Intelligence PRs #337, #341, #342).
**Branch:** merged to `dev` (branches/worktrees cleaned up)

## Final Validation Evidence (all observed)

- Merged: PR #1 (`0fbe82b`), PR #2 (`84215b1`) on `Alter-Igor/opencode`
- `bun typecheck` from `packages/opencode` on merged `dev`: 0 errors
- `bun test` (3 new files) on merged `dev`: 39/39 pass
- Activation probe 2026-07-20: paired correction accepted — `coder_stats` record `{"tool":"edit","model":"openrouter/kimi-k3","original":"const enabled: boolean = 'yes'","corrected":"const enabled: boolean = true",...}`
- Learning loop verified end-to-end: 6 lessons promoted via human-gated review board (incl. the keystone-role-claim lesson, independently re-verified), 2 rejected (incl. this plugin's own test probes); A/B generation tests confirm promoted lessons are retrieved (`retrievalMode: rag`) and followed
- Launcher note: `opencodealt.bat` (Nodist bin) fixed to preserve caller cwd and pass args through

## Known Follow-ups (not blocking)

- Phase 2 (permission-rejection detection, formatter pairs, malformed tool calls) needs core hooks — parked, see `ai-memory.md`
- Future verification probes of this plugin should omit `category` so no noise candidates form
- Staging→prod reporter promotion: bake on staging ~1 week, then flip `SYNAPSE_CODER_URL` to the prod facade


## Current State

## Task Status (final — all Phase 1 complete)

The E2E run against the real staging service caught a payload schema mismatch
(ISS-001) that unit tests could not — fixed via a pairing redesign (report only
`original`→`corrected` pairs; one-sided detections are held 30 min then dropped).
See `evidence/phase4-e2e-verification.md`.

| Task | Status | Notes |
|------|--------|-------|
| 1.1 — MCP server config | DONE | `synapse-coder` connected via `mcp list`; local-entry shape fixed (ISS-004). Evidence: `evidence/phase1-mcp-verification.md` |
| 1.2 — MCP tool discovery verification | DONE | 12 tools incl. `coder_report_correction`; evidence file written |
| 2.1 — Plugin scaffold + model tracking | DONE | `.opencode/plugin/synapse-coder-reporter.ts` |
| 2.2 — LSP diagnostics detection hook | DONE | Detects non-empty `metadata.diagnostics` on edit/write/apply_patch |
| 2.3 — Permission rejection detection | DEFERRED | Phase 2 — infeasible without core changes (plan review) |
| 2.4 — Language derivation utility | DONE | Extension map; covered by unit tests |
| 3.1 — Reporter module (MCP call) | DONE (redesigned) | Direct JSON-RPC `tools/call`; payload matches live schema (ISS-001) |
| 3.2 — User opt-in gate | DONE (deviation) | Env var gate (default off) + first-use TUI toast, once-per-project marker (ISS-003) |
| 3.3 — Error handling + offline queue | DONE | `.opencode/synapse-coder-queue.json`, retry on load + 5-min timer, flush on dispose |
| 3.4 — Async fire-and-forget | DONE | No `await` on report path; covered by timing test |
| 4.1 — Unit tests | DONE | 28 tests in `test/plugin/synapse-coder-reporter/synapse-coder-reporter.test.ts` |
| 4.2 — Integration tests | DONE | Simulated LSP diagnostics → paired fix → mocked MCP call asserted end-to-end |
| 4.3 — E2E verification | DONE | Real staging accepted paired correction; `coder_stats` evidence (ISS-001 found & fixed) |

## Companion Work (merged in PR #1)

| Item | Status | Notes |
|------|--------|-------|
| `alterspective-rag-standards` plugin + 6 tests | MERGED | System-prompt standards injection (Team A) |
| Health/version sidecar `.opencode/scripts/health-check.ts` + 5 tests | MERGED | `/health` + `/version` (Team B; path bug fixed ISS-005) |
| Brand compliance verification | DONE | All compliant, no fixes needed (Team C report) |
