# Rollover v2 — Deterministic Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, chosen by the user) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the swap a single deterministic, LLM-free transformation that fires on every threshold-crossing user message regardless of extraction/model state; the ledger becomes an optional, never-blocking enrichment.

**Architecture:** `core/swapDecision` loses the extraction safe-point; a new `core/projection.ts` renders the frozen context mechanically (verbatim prompts, reply first-lines, touched files, optional ledger sections via the existing packer); the scheduler always runs extraction per idle turn and refreshes the frozen render after success; the gate is deleted.

**Tech Stack:** TypeScript (Effect-typed adapter), Bun test, zod (existing package `opencode/packages/rollover`).

**Spec:** `packages/rollover/docs/2026-11-19-deterministic-swap-design.md`

## Global Constraints

- English-only in all tracked files (code, comments, tests, docs, commit messages, PR).
- Core (`src/core/**`) must not import harness packages (existing `tests/core/imports.test.ts` enforces).
- Swap decision contains no LLM call and no extraction-cursor condition.
- `packLedger`'s current output must stay byte-identical for pure-ledger inputs (existing `tests/core/packer.test.ts` pins it).
- Branch `rollover-swap` off `origin/dev`; conventional commit subjects ≤3 words after `type(scope):`.
- Run tests from `packages/rollover` only; root check via `bun run check`.

## Review Focus

- Threshold crossed + extraction never ran → the swap must happen (old `extraction_lagging` loop) — pinned in Task 1 tests.
- Two freezes from identical inputs must render byte-identical text — pinned in Task 3.
- Ledger refresh must not move `cutoffMessageId`/`epoch` or duplicate the synthetic part — pinned in Task 6.
- A record whose `turnMessageId` is absent from the message list must be treated conservatively (included) — pinned in Task 3.
- Tool_use/tool_result pairs in the kept region (cutoff onward) must remain untouched — pinned by existing `tests/adapter/applyPlan.test.ts` and Task 4 view tests.

---

### Task 1: Deterministic swap decision

**Files:** Modify `src/core/swapDecision.ts`; Test `tests/core/swapDecision.test.ts`

**Interfaces:**
- Produces: `SwapContext { msgs, st, thresholdValue, toolsOpen, contextTokens, anchor?, ignoreDecided? }` (drop `extractionCaughtUp`); `SwapDecision = swap | none(markDecided) | defer(reason: "open_tools")`.
- Port from standalone package (same code): `ignoreDecided?: boolean` and condition-2 honoring it.

- [ ] Step 1: Failing tests — threshold crossed + extraction cursor never advanced (cursor null) → `{action:"swap"}`; `ignoreDecided: true` re-evaluates a decided prompt; defer only for `open_tools`.
- [ ] Step 2: `bun test tests/core/swapDecision.test.ts` → new tests FAIL.
- [ ] Step 3: Implement — remove condition 5's extraction check and `extractionCaughtUp` input; port `ignoreDecided`.
- [ ] Step 4: Tests PASS.
- [ ] Step 5: Commit `fix(rollover): deterministic swap decision`.

### Task 2: Packer section refactor (behavior-preserving)

**Files:** Modify `src/core/packer.ts`; Test `tests/core/packer.test.ts`

**Interfaces:**
- Produces: `export function rolloverShell(epoch: number): string`, `export const ROLLOVER_SHELL_CLOSE = "</rollover_context>"`, `export function packLedgerSections(active: LedgerRecord[], epochAtSwap: number, budgetTokens: number): { sections: Array<{ title: string; lines: string[] }>; truncated: boolean }` (existing per-category budgeting preserved).
- `packLedger` keeps its exact signature and byte-identical output, now assembling over `packLedgerSections`.

- [ ] Step 1: Run `bun test tests/core/packer.test.ts` → all PASS (baseline guard).
- [ ] Step 2: Refactor internals; no signature/output change.
- [ ] Step 3: `bun test tests/core/packer.test.ts` → PASS.

### Task 3: Mechanical projection module

**Files:** Create `src/core/projection.ts`; Test `tests/core/projection.test.ts`

**Interfaces:**
- Consumes: `isRealUserMessage/hasTextPart` (view), `estimateTokens` (tokens), `packLedgerSections/rolloverShell` (packer), `msgToolPaths` (new, below).
- Produces: `export function collectTouchedPaths(msgs: NMessage[], beforeIdx: number): Record<string, number>` — repo-agnostic path strings from `edit|write|patch|multiedit` tool-part inputs, newest-tool-turn last; and `export function projectRollover(input: { msgs; cutoffId; epoch; cfg; lines; touchedFiles }): { renderText; truncated }` producing, in order: corrections/decisions/open items/verifications/objectives (ledger, half of `cfg.renderBudgetTokens`; open items positionally filtered to records whose `turnMessageId` is missing from `msgs` or appears before the cutoff), then `## User prompts` (every pre-cutoff real user msg, verbatim, each middle-capped at 600 chars), `## Assistant progress` (first line ≤200 chars per pre-cutoff assistant reply with text), `## Files touched` (union of `collectTouchedPaths` and `state.touchedFiles`, max 40), `## Last assistant reply` (≤1500 chars, skipped when identical to tail's last reply) — all inside `rolloverShell(epoch)` … close. Over budget: drop oldest progress lines, then truncate files, then ledger section lines; set `truncated`.

- [ ] Step 1: Failing tests — determinism (two calls byte-identical), prompts verbatim + 600 cap, progress first-line cap, no-ledger render has no record sections, record before cutoff included / after cutoff excluded / unknown turnMessageId included, budget overflow drops progress oldest-first, shell present.
- [ ] Step 2: `bun test tests/core/projection.test.ts` → FAIL.
- [ ] Step 3: Implement per interface above.
- [ ] Step 4: PASS.
- [ ] Step 5: Commit `feat(rollover): mechanical projection render`.

### Task 4: Freeze uses the projection

**Files:** Modify `src/core/view.ts` (call `projectRollover` for `renderText`; keep tail/lastReply/tokensAfter logic); Test `tests/core/view.test.ts` (update render assertions: mechanical sections present with no ledger input).

- [ ] Step 1: Update/add view tests → FAIL against current packer-only render.
- [ ] Step 2: Rewire `freezeRollover`.
- [ ] Step 3: `bun test tests/core/view.test.ts tests/adapter/applyPlan.test.ts` → PASS.
- [ ] Step 4: Commit `feat(rollover): freeze via projection`.

### Task 5: Adapter wiring + divergence fixes

**Files:** Modify `src/adapter/opencode/hooks.ts`; Test `tests/adapter/touched-files.test.ts` (should already be red on `dev` — port the standalone off-mode gate: no state materialization/no tracking when disabled), `tests/integration/swap.test.ts`

- runTransform: drop `isCaughtUp`/extraction inputs from `decideSwap`.
- runImmediateSwap: keep `ignoreDecided: true`; extraction catch-up becomes fire-and-forget enrichment (`void deps.scheduler.runNow(sid)`) instead of a pre-decide await; success informs the refresh path, not the swap.
- Port the 2026-11-17 touched-file/usage off-mode fixes from standalone (fixes the 2 red tests).
- [ ] Step 1: `bun test tests/adapter/touched-files.test.ts` → red confirmed, then fix → green.
- [ ] Step 2: Update swap integration tests (no defer on lagging extraction) → PASS.
- [ ] Step 3: Commit `fix(rollover): deterministic swap wiring`.

### Task 6: Scheduler without gate + ledger refresh

**Files:** Modify `src/adapter/opencode/scheduler.ts`; Test `tests/integration/scheduler.test.ts`

**Interfaces:**
- Produces: refresh step after successful extraction and after consolidation — when `state.rollover` exists and the cutoff message is present in `getMessages(sid)`, re-render with `projectRollover` (same cutoff/epoch, current active records positionally filtered to pre-cutoff), write `state.rollover.renderText` + recomputed `tokensAfter`, metric `ledger_enriched`.

- [ ] Step 1: Failing test — extraction completes after a swap → `renderText` gains the ledger section; cutoff/epoch unchanged; second completion with no new records → byte-identical render.
- [ ] Step 2: Delete gate classification from `onIdle` (always run via `runNow`), remove `core/gate` imports.
- [ ] Step 3: Implement refresh; PASS; remove gate tests (`tests/core/gate.test.ts`, `tests/integration/gate*.test.ts`, gate fixtures).
- [ ] Step 4: Commit `feat(rollover): gateless extraction with render refresh`.

### Task 7: Config + status surface

**Files:** Modify `src/core/config.ts` (add `ledger: boolean`, default `true`; remove `extractionGate`), `src/core/messages.ts` (`Current context` line gains ` (estimate)` suffix when source is estimate), `src/adapter/opencode/ctl.ts` (thread `lastContextSource`); Tests `tests/core/config.test.ts`, `tests/core/messages.test.ts`, `tests/integration/commands.test.ts`

- [ ] Step 1: Failing tests for the two keys and the suffix.
- [ ] Step 2: Implement.
- [ ] Step 3: PASS. Commit `feat(rollover): ledger switch and context source display`.

### Task 8: Docs, version, full verification

**Files:** Modify `README.md` (config table: `ledger`, drop `extractionGate`; changelog entry for 0.2.0), `package.json` (0.2.0), `docs/decisions.md` (two 2026-11-19 decisions: no LLM in swap path; gate withdrawn), `docs/spec.md` (v2 amendment note at Part A §8.3)

- [ ] Step 1: Full package suite `bun test` → all green.
- [ ] Step 2: `bun run typecheck` → clean.
- [ ] Step 3: Root `bun run check` (canonical lint/type gate) → clean.
- [ ] Step 4: Grep the branch diff for Turkish characters and the forbidden strings → none.
- [ ] Step 5: Commit `chore(rollover): version 0.2.0 and docs`.

### Task 9: Live smoke in an isolated runtime

Build `packages/cli` dist in the worktree (`--single --skip-install`), reuse the `experiments/2026-11-17-gate-turkish/setup-env.sh` isolation pattern against a scratch project, run scripted turns that cross the threshold with extraction never scheduled (extraction model unreachable on purpose), and assert: `swap` metric fires on the following user message; `/rollover status` shows the mechanical render. If provider credentials make the live model unavailable, record that honestly and rely on the mock-LLM integration coverage instead — no silent claims.

### Task 10: PR + local install

- Push `rollover-swap` to origin; open PR to `dev`. Title `feat(rollover): deterministic LLM-free swap pipeline`. Body: Summary + Test plan, no attribution lines.
- Local usability: write `~/.config/opencode/plugin/rollover/index.ts` and `tui.ts` re-exporting the fork source (main checkout after a local `--ff-only` update of `dev`, worktree path if the user prefers the branch first); restart note for the elected desktop service; verify by loading the plugin through the fork binary in a scratch session and running `/rollover status`.
