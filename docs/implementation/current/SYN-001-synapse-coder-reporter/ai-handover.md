# SYN-001: AI Handover

**Session:** 2026-07-18
**Status:** Plan created, awaiting review → then execution
**Next step:** Plan review by sub-agent, then execution via `21-planning-execute-plan` skill

## What was done this session

1. **Repo entry safety check** — clean on `dev`, no active worktrees (R3 evidence: `git branch --show-current` = `dev`, `git status --short` = empty, `git worktree list` = only primary)
2. **Codebase investigation** — delegated to explore agent; full findings in `evidence/investigation-findings.md`. Key hook points identified with file:line citations.
3. **Worktree created** — `C:\GitHub\opencode---synapse-coder-reporter` on branch `synapse-coder-reporter` (AIMETH-005 compliance)
4. **Plan documents created** — full `current/` artifact set under `docs/implementation/current/SYN-001-synapse-coder-reporter/`

## What needs to happen next

1. **Plan review** — a fresh sub-agent reviews the plan for completeness, feasibility, and standards compliance. Review checklist:
   - [ ] All completion-verification items from `LIF-001-20-planning-create-plan` satisfied
   - [ ] Assumptions have evidence (R3)
   - [ ] Options presented with trade-offs
   - [ ] Devil's advocate completed before recommendation
   - [ ] >= 3 failure modes in pre-mortem
   - [ ] Every task has Deliverable + Verification method
   - [ ] >= 4 risks across >= 3 categories
   - [ ] No core code changes (fork-local compliance)

2. **Address review feedback** — fix any issues found by the reviewer

3. **Execute the plan** — using `21-planning-execute-plan` skill with multi-agent coordination:
   - Wave 1: Tasks 1.1, 1.2 (foundation + MCP wiring)
   - Wave 2: Tasks 2.1–2.4 (correction detection plugin, parallel)
   - Wave 3: Tasks 3.1–3.4 (reporting + consent, parallel)
   - Wave 4: Tasks 4.1–4.3 (testing + verification, parallel)

## Key context for the next session

- **Branch:** `synapse-coder-reporter` in worktree `C:\GitHub\opencode---synapse-coder-reporter`
- **Plan location:** `docs/implementation/current/SYN-001-synapse-coder-reporter/`
- **The plugin approach is non-negotiable** — no core code changes to `edit.ts`, `write.ts`, `llm.ts`, `processor.ts`, `tools.ts`
- **Synapse Coder staging facade:** `https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp`
- **Bearer token:** vault secret `synapse-coder-mcp-staging-bearer-token`
- **opencode does NOT use `.mcp.json`** — use `opencode.json` → `mcp` key
- **The v1 plugin `Hooks` interface is live and stable** (`packages/plugin/src/index.ts:222-335`)

## Validation gates (must pass before merge)

- `bun typecheck` from `packages/opencode` — 0 errors
- `bun test` from `packages/opencode` — all pass
- `git diff dev..synapse-coder-reporter -- packages/opencode/src/tool/ packages/opencode/src/session/ packages/opencode/src/lsp/` — empty (fork-local)
- No plaintext secrets in `opencode.json`
- Plugin hook overhead < 5ms per tool call
