# Phase 4 Evidence: E2E Verification (Task 4.3)

**Date:** 2026-07-19
**Verifier:** AI agent (resume session)
**Branch:** `synapse-coder-reporter` (worktree `C:\GitHub\opencode---synapse-coder-reporter`)

## Finding 1 — payload schema mismatch (caught by E2E, would have shipped broken)

The plan (and the global agent-instructions doc) assumed the payload
`{ reporterModel, category, language, original, corrected, reason }`.
E2E against the real staging facade proved that wrong — `coder_report_correction`
rejected it with MCP -32602:

```
Input validation error: "tool" Required, "model" Required, too_small (empty string)
```

Actual schema (live `tools/list`, 2026-07-19):

| Field | Requirement |
|---|---|
| `tool` | **required**, string minLength 1 — tool that produced the original output |
| `model` | **required**, string minLength 1 — model that produced the original output |
| `original` | **required**, string minLength 1 |
| `corrected` | **required**, string minLength 1 — **empty string rejected** |
| `reason`, `reporterModel`, `language`, `taskFamily`, `checkPattern` | optional |
| `category` | optional, kebab-case pattern |
| `severity` | optional enum info/minor/major/critical |
| | `additionalProperties: false` |

**Consequence:** the one-sided design (`corrected: ""`) could never work. Redesigned:
a failing edit is held as *pending* and only reported when a follow-up edit to the
same file in the same session lands with clean diagnostics, pairing
`original` (failing edit) with `corrected` (fixing edit). Ungaired detections are
dropped after a 30-minute window. No placeholder values are sent, so the learning
corpus is not polluted.

## Finding 2 — paired E2E against real staging: PASS (AC-005)

Probe: real plugin instance, real network, staging facade, token from vault
`synapse-coder-mcp-staging-bearer-token`.

Plugin structured log:

```json
{"event":"synapse_correction_detected","reported":false,"reason":"awaiting_fix","category":"lsp-typecheck","language":"typescript"}
{"event":"synapse_correction_reported","reported":true,"category":"lsp-typecheck","language":"typescript"}
```

`coder_stats` on staging after the probe (`corrections` array, was empty before):

```json
{"tool":"edit","model":"openrouter/kimi-k3","original":"const x: number = 'not a number'",
 "corrected":"const x: number = 42",
 "reason":"[{\"message\":\"E2E-VERIFY SYN-001 pairing 2026-07-18T15:46:35.361Z\",\"severity\":\"error\"}]",
 "reporterModel":"openrouter/kimi-k3","category":"lsp-typecheck","language":"typescript",
 "recordedAt":1784389596668}
```

The server accepted the correction (candidate only — lesson promotion remains
human-gated by design).

## Test suite state

- `packages/opencode/test/plugin/synapse-coder-reporter/synapse-coder-reporter.test.ts` — 28 tests: detection, tool filtering, language derivation, pairing rules (held/equal/different-file/window-expiry), opt-in gate, offline queue, model tracking, fire-and-forget, first-use toast.
- `test/plugin/synapse-coder-reporter/health-check.test.ts` — 5 tests (sidecar HTTP).
- `test/plugin/alterspective-rag-standards/alterspective-rag-standards.test.ts` — 6 tests.
- 34/34 pass (4/4 consecutive clean full-file runs); `bun typecheck` from `packages/opencode`: 0 errors.

## Known flake (environmental)

`bun test` intermittently reports "(unnamed) — a beforeEach/afterEach hook timed out"
(~10–45s) on Windows, single- or multi-file, with no deterministic repro. Deep
instrumentation on 2026-07-19 showed:

- Every beforeEach/afterEach/afterAll hook completes in milliseconds; all 28 tests
  finish in < 1.5s of wall time — the phantom is attributed by the runner **after
  `afterAll` exits**, not by any real hook stall.
- `process._getActiveHandles()` / `_getActiveRequests()` at `afterAll`: **0/0** in
  clean runs — no dangling timers, sockets, or file handles from the plugin or tests.
- Flake occurrences cluster right after file edits (Windows Defender rescan of fresh
  files) and under tight-loop load; 25 consecutive clean runs once quiesced.
- Plugin report `AbortController` timeout hardened 30s → 10s as a precaution.

Not a logic failure — all tests pass deterministically when the runner is not
stalled. The repo test script's `--only-failures` rerun absorbs residual flake. If
it recurs, re-apply the hook-timing + active-handle dump technique (recorded in
session history) to capture the handle list in a failing run.

## Doc gap filed

Global agent instructions (`C:\GitHub\AGENTS.md` "Synapse Coder" section, source:
`Alterspective-Intelligence\_meta\agent-config\C-GitHub-AGENTS.md`) document the
report payload without the required `tool`/`model` fields and the non-empty
`corrected` constraint. Cross-repo fix filed in `issues.md` — not edited from this
session per cross-repo change rules.
