# SYN-001: Synapse Coder Learning Loop Integration — Index

**Feature ID:** SYN-001
**Status:** Planning — awaiting review
**Branch:** `synapse-coder-reporter`
**Worktree:** `C:\GitHub\opencode---synapse-coder-reporter`

## Plan Summary

### Overview

| Element | Value |
|---------|-------|
| Goal | Feed opencode's code-correction events into Synapse Coder's `coder_report_correction` learning loop to grow the shared lesson corpus |
| Core Insight | opencode already collects correction signals (LSP diagnostics in tool metadata, v1 plugin hooks); the integration is a plugin that hooks existing signals — no core changes |
| Approach | Plugin-only (Option A): MCP config + v1 plugin with `tool.execute.after` and `event` hooks |
| Why Not Option B (core changes) | Touches high-churn core files; violates fork-local "small, low-churn" constraint |
| Why Not Option C (LLM self-reports) | LLMs rarely self-report; poor signal quality; doesn't capture silent corrections |
| Scope - Included | MCP config, v1 plugin at `.opencode/plugin/`, LSP diagnostics detection (Signal 1), opt-in gate, offline queue, tests |
| Scope - Excluded | Permission rejection detection (Signal 2 — deferred; infeasible without core changes), core code changes, `experimental_repairToolCall` hook, format-on-write capture, thumbs-up/down UI |

### Implementation Structure

| Element | Count |
|---------|-------|
| Phases | 4 |
| Tasks | 12 total (2.3 deferred to Phase 2) |
| Waves | 4 |
| Review cycles | 1 per wave × 4 waves = 4 total |

### Execution Strategy

| Element | Value |
|---------|-------|
| Build Agents | 3-4 for parallel implementation tasks |
| Review Agents | 2-3 for code quality, security, integration |
| Review Rounds | 1 minimum per wave |
| Quality Gates | TypeScript 0 errors, tests all pass, fork-local compliance (no core diffs), no plaintext secrets, hook overhead < 5ms |

### GitHub Tracking

| Element | Value |
|---------|-------|
| Parent issue | (to be created) |
| Module issues | 1 (synapse-coder-reporter plugin) |
| Project tracking | Branch `synapse-coder-reporter` → PR → review → merge |
| Closeout rule | All acceptance criteria met, tests pass, fork-local diff verified, worktree cleaned up |

### Standards Coverage

| Concern | Planned Status |
|---------|----------------|
| Vision alignment | N/A — no VISION.md in opencode repo (fork-local add-on) |
| Documentation/work tracking | Full `current/` artifact set created |
| Realtime / SignalR | N/A — not a realtime feature |
| Versioning | N/A — plugin, not a shipped runtime artifact |
| Analytics/privacy | Opt-in gate (default off); no code leaves without consent; structured logging |
| Accessibility | N/A — plugin has no UI beyond a TUI toast |
| Performance | Async fire-and-forget; hook overhead < 5ms |
| LLM observability | N/A — not an LLM feature; feeds Synapse Coder's learning loop |
| Hosted adversarial review | N/A — Synapse Coder runs on Azure Container Apps (staging facade), but this integration is a passive consumer of its MCP API, not a deployment to GpuAsAService. Adversarial review deferred — the integration does not deploy or modify GpuAsAService infrastructure |

### Top 3 Risks

| Risk | Mitigation |
|------|------------|
| User sends sensitive client code without realizing | Opt-in default off; first-use TUI toast; structured logging; disable anytime |
| Synapse Coder staging facade down | Health check on load; graceful degradation; offline queue |
| Plugin hook overhead slows tool execution | Async fire-and-forget; no `await` in hook path; benchmark < 5ms |

### Uncertainties

- Whether Synapse Coder accepts one-sided corrections (original without corrected) — verify in Phase 1 Task 1.2
- Whether `tool.execute.after` fires for MCP tools as well as built-in tools — verify in Phase 1 Task 1.2
- Exact `coder_report_correction` response shape — verify in Phase 1

### Expected Outcome If Implemented

After implementation, opencode sessions that produce LSP errors after edits, or where users reject edits with feedback, will automatically (with user opt-in) report the original code and the correction to Synapse Coder's learning loop. Over time, this grows the shared lesson corpus, making Synapse Coder (and by extension all Alterspective AI coding tools) better at avoiding the same mistakes. The user sees a small indicator when a correction is being reported and can disable it at any time.

**Minimum coverage:**
- What will exist: a `synapse-coder-reporter` plugin and MCP config that passively detects and reports code corrections
- What the user can do: enable/disable reporting via config; see when corrections are detected; benefit from improved Synapse Coder lessons over time
- Limitations: one-sided corrections (no next-turn fix pairing); can't capture format-on-write or malformed-tool-call corrections without Phase 2 core changes

### Further Information Needed From User

No further information needed from user at this stage. The plan is ready for review.

### Quality Validation

| Check | Status |
|-------|--------|
| All GATE PASSED tokens emitted | YES |
| All checklist items complete | YES |

### Ready to Proceed?

YES — ready for plan review, then execution with `Skills/Lifecycle/LIF-001-21-planning-execute-plan.md`.

### Suggested Next Step

1. Spawn a review sub-agent to review the plan against the `LIF-001-20-planning-create-plan` completion checklist
2. Address any review feedback
3. Execute via `21-planning-execute-plan` with multi-agent coordination (4 waves, 13 tasks)

## Document Index

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Feature overview |
| [requirements.md](requirements.md) | Requirements, assumptions, standards |
| [technical-design.md](technical-design.md) | Architecture, hook points, options analysis |
| [impact-analysis.md](impact-analysis.md) | Affected files, risk assessment |
| [acceptance-criteria.md](acceptance-criteria.md) | Acceptance criteria and test scenarios |
| [checklist.md](checklist.md) | Task breakdown by phase |
| [status.md](status.md) | Current execution status |
| [module-register.md](module-register.md) | Module registry and dependencies |
| [issues.md](issues.md) | Open issues and blockers |
| [ai-memory.md](ai-memory.md) | Key decisions and gotchas |
| [ai-handover.md](ai-handover.md) | Session continuity |
| [evidence/investigation-findings.md](evidence/investigation-findings.md) | Full codebase investigation report |
