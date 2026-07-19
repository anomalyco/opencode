# SYN-001: Synapse Coder Learning Loop Integration

**Feature ID:** SYN-001
**Status:** Planning
**Created:** 2026-07-18
**Owner:** Igor Jericevich
**Branch:** `synapse-coder-reporter`
**Worktree:** `C:\GitHub\opencode---synapse-coder-reporter`

## Summary

Feed opencode's code-correction events into Synapse Coder's `coder_report_correction` learning loop. When opencode observes a correction (LSP diagnostics after an edit, a user rejecting an edit with feedback), the integration reports the original and corrected code to Synapse Coder, growing the shared lesson corpus and improving future AI coding assistance across Alterspective.

## Core Insight

opencode already collects the key correction signals — LSP diagnostics are attached to tool result metadata (`packages/opencode/src/tool/edit.ts:203-208`), and the v1 plugin system has `tool.execute.after` and `event` hooks (`packages/plugin/src/index.ts:274-281`, `224`) that fire on every tool execution and event. The integration is a v1 plugin that hooks these existing signals and calls the Synapse Coder MCP tool. **No core code changes required for Tier 1 signals.**

## Approach

Plugin-only integration (Option A):
1. Configure Synapse Coder as a remote MCP server in `opencode.json` (staging facade + bearer token from vault)
2. Write a v1 plugin (`synapse-coder-reporter`) that hooks `tool.execute.after` and `event`
3. Detect corrections: non-empty LSP diagnostics after edits, permission rejections with feedback
4. Call `coder_report_correction` MCP tool with original/corrected/category/language/reason/reporterModel
5. User opt-in gate; graceful degradation when Synapse is unreachable

## Why Not Alternatives

- **Option B (core code changes + plugin):** Touches high-churn core files (`edit.ts`, `write.ts`, `llm.ts`) that conflict with upstream merges. The fork-local note in `AGENTS.md` explicitly requires "small and in low-churn files." Rejected.
- **Option C (custom tool, LLM self-reports):** LLMs rarely self-report corrections; signal quality is poor. Doesn't capture silent corrections. Rejected.

## Scope

**Included:**
- Synapse Coder MCP server config in `opencode.json`
- v1 plugin (`synapse-coder-reporter`) at `.opencode/plugin/synapse-coder-reporter.ts` with `tool.execute.after` and `chat.message` hooks
- Correction detection: LSP diagnostics after edits (Signal 1 — primary)
- User consent gate (opt-in setting, default off)
- Error handling and offline queue
- Unit and integration tests

**Excluded (Phase 2, deferred):**
- Permission rejection with feedback detection (Signal 2 — infeasible in Phase 1: `permission.v2.replied` event doesn't carry feedback text; `tool.execute.after` doesn't fire on errors)
- Core code changes to capture pre-format LLM literal output
- New plugin hook for `experimental_repairToolCall` corrections
- Format-on-write before/after capture (requires core changes)
- Thumbs-up/down UI (greenfield, separate feature)

## Documents

| Document | Purpose |
|----------|---------|
| [requirements.md](requirements.md) | What we're building and why |
| [technical-design.md](technical-design.md) | Architecture, hook points, options analysis |
| [impact-analysis.md](impact-analysis.md) | Affected files, risk assessment |
| [acceptance-criteria.md](acceptance-criteria.md) | How we know it's done |
| [checklist.md](checklist.md) | Task breakdown |
| [status.md](status.md) | Current execution status |
| [module-register.md](module-register.md) | Module registry |
| [issues.md](issues.md) | Open issues and blockers |
| [ai-memory.md](ai-memory.md) | Key decisions and gotchas |
| [ai-handover.md](ai-handover.md) | Session continuity |

## Investigation Evidence

Full codebase investigation findings are in `evidence/investigation-findings.md`. Key hook points:

| Hook Point | File:Line | Signal |
|------------|-----------|--------|
| LSP diagnostics after edit | `packages/opencode/src/tool/edit.ts:197-201` | Non-empty `metadata.diagnostics` |
| LSP diagnostics after write | `packages/opencode/src/tool/write.ts:75-90` | Non-empty `metadata.diagnostics` |
| `tool.execute.after` plugin hook | `packages/plugin/src/index.ts:274-281` | Receives `output.metadata` |
| `event` plugin hook | `packages/plugin/src/index.ts:224` | Receives all events |
| Permission rejection | `packages/opencode/src/permission/index.ts:125` | `CorrectedError.feedback` |
| Model ID available | `packages/opencode/src/session/llm.ts:40` | `input.model.providerID/id` |
