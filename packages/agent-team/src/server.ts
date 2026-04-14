import type { PluginInput, PluginOptions, Hooks } from "@opencode-ai/plugin"
import { Orchestrator } from "./orchestrator/index.js"
import { parseTeamConfig, type TeamConfig } from "./config.js"
import { createAgentListTool } from "./tools/agent-list.js"
import { createAgentSendTool } from "./tools/agent-send.js"
import { createAgentBroadcastTool } from "./tools/agent-broadcast.js"
import { createAgentDelegateTool } from "./tools/agent-delegate.js"
import { createAgentShareTool } from "./tools/agent-share.js"
import { createAgentHandoffTool } from "./tools/agent-handoff.js"
import { createAgentQueryTool } from "./tools/agent-query.js"
import { createAgentRevertTool } from "./tools/agent-revert.js"
import { createTeamSpawnTool } from "./tools/team-spawn.js"
import { createPermissionHook } from "./hooks/permission.js"
import { createToolExecuteBeforeHook, createToolExecuteAfterHook } from "./hooks/tool-guard.js"
import { createSystemPromptHook } from "./hooks/system-prompt.js"
import { createEventHandlerHook } from "./hooks/event-handler.js"
import { createCompactionHook } from "./hooks/compaction.js"
import { createShellEnvHook } from "./hooks/shell-env.js"

function teamToOrchConfig(cfg: TeamConfig) {
  return {
    maxAgents: cfg.limits.max_agents,
    maxConcurrent: cfg.limits.max_concurrent_tasks,
    maxDepth: cfg.limits.max_delegation_depth,
    taskTimeoutSeconds: cfg.limits.task_timeout_seconds,
    heartbeatWarningMs: cfg.watchdog.heartbeat_warning_ms,
    zombieTimeoutMs: cfg.watchdog.zombie_timeout_ms,
    dailyLimitUsd: cfg.budget.daily_limit_usd,
    perAgentDailyUsd: cfg.budget.per_agent_daily_usd,
    perTaskMaxUsd: cfg.budget.per_task_max_usd,
    perTaskMaxTokens: cfg.budget.per_task_max_tokens,
  }
}

async function autoSpawnAgents(orch: Orchestrator, cfg: TeamConfig) {
  if (!cfg.enabled) return
  for (const [id, def] of Object.entries(cfg.agents)) {
    try {
      await orch.spawn({
        agent_id: id,
        role: def.role,
        capabilities: def.capabilities,
      })
    } catch {}
  }
}

export default {
  id: "agent-team",
  server: async (input: PluginInput, options?: PluginOptions): Promise<Hooks> => {
    const cfg = parseTeamConfig(options)
    const orch = new Orchestrator(input.directory, teamToOrchConfig(cfg))
    orch.setClient(input.client as any)
    await orch.start()
    await autoSpawnAgents(orch, cfg)

    return {
      tool: {
        team_spawn: createTeamSpawnTool(orch),
        agent_list: createAgentListTool(orch),
        agent_send: createAgentSendTool(orch),
        agent_broadcast: createAgentBroadcastTool(orch),
        agent_delegate: createAgentDelegateTool(orch),
        agent_share: createAgentShareTool(orch),
        agent_handoff: createAgentHandoffTool(orch),
        agent_query: createAgentQueryTool(orch),
        agent_revert: createAgentRevertTool(orch),
      },
      event: createEventHandlerHook(orch),
      "permission.ask": createPermissionHook(orch),
      "tool.execute.before": createToolExecuteBeforeHook(orch, input.directory),
      "tool.execute.after": createToolExecuteAfterHook(orch),
      "experimental.chat.system.transform": createSystemPromptHook(orch, input.directory),
      "experimental.session.compacting": createCompactionHook(orch),
      "shell.env": createShellEnvHook(orch),
      config: async () => {},
    }
  },
}
