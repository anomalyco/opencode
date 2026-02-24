# Research: Cline Subagent Architecture

**Date:** 2026-02-24
**Status:** TODO — pick up in next session

## Research Questions

1. How does Cline form subagents? How does the AI decide how many to create?
2. What task distribution strategy is used? How are tasks assigned to each subagent?
3. How is context shared between parent agent and subagents?
4. How are subagent outputs aggregated back into the main conversation?
5. What happens when a subagent task errors? Error handling and recovery.
6. How could this inspire improvements to opencode's existing subagent system?

## Key References

- **CLI Subagent Command Transformation**: `src/integrations/cli-subagents/subagent_command.ts`
  - `isSubagentCommand()` — identifies simplified cline commands
  - `transformClineCommand()` — injects `--json -y` flags for autonomous execution
  
- **Agent Client Protocol (ACP)**: `cli/src/acp/AcpAgent.ts`
  - Bridges ClineAgent with AgentSideConnection for stdio-based communication
  - Handles permission requests, forwards session events
  
- **ClineAgent**: `cli/src/agent/ClineAgent.ts`
  - Implements ACP agent interface
  - Translates ACP requests into core Controller operations
  - Manages authentication, session modes, processes user prompts
  
- **Message Translator**: `cli/src/agent/messageTranslator.ts`
  - Converts ClineMessage objects to ACP SessionUpdate messages
  - Computes deltas for streaming (avoids duplicate content)

## CodeWiki References

- https://codewiki.google/github.com/cline/cline#cli-subagent-command-transformation
- https://codewiki.google/github.com/cline/cline#command-line-interface-cli-functionality
- https://codewiki.google/github.com/cline/cline#agent-client-protocol-acp-integration-for-external-control

## Comparison with OpenCode's Subagent System

OpenCode already has subagents (`TaskTool` in `packages/opencode/src/tool/task.ts`):
- Subagents are spawned via the `task` tool
- Each subagent gets its own child session
- Subagent types: explore, plan, general (configurable per agent)
- Results returned as tool output to parent session

**Gaps to investigate:**
- Does Cline support parallel subagents? (OpenCode does via plan mode Phase 1)
- How does Cline's ACP protocol compare to opencode's Bus event system?
- Can we adopt Cline's streaming delta pattern for subagent updates?

## Tonight's Session Summary (2026-02-24, 2:37 AM - 4:57 AM)

### 6 PRs Submitted to opencode (sst/opencode):
1. **#14820** — Streaming content duplication fix (global-sdk.tsx voided Set)
2. **#14821** — Font size settings (CSS vars + terminal + UI stepper)
3. **#14826** — ContextOverflowError auto-recovery (processor.ts)
4. **#14827** — Prune before compaction (prompt.ts)
5. **#14831** — Context usage card with compact button (session-context-tab.tsx)
6. **#14835** — Wide mode setting (full-width chat toggle)

### Issues Created:
- #14822, #14823, #14824, #14825, #14830, #14834

### All branches merged into `origin/dev` on fork (PrakharMNNIT/opencode)
