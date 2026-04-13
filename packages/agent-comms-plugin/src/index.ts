import type { PluginInput, Hooks } from "@opencode-ai/plugin"
import { parseConfig } from "./config"
import { initDb, purgeExpired } from "./db"
import { createAgentListTool } from "./tools/agent-list"
import { createSessionListTool } from "./tools/session-list"
import { createSessionSendTool } from "./tools/session-send"
import { createSessionReadTool } from "./tools/session-read"
import { createSessionRenameTool } from "./tools/session-rename"
import { createEventHook } from "./hooks/event"
import { createSystemTransformHook } from "./hooks/system-inject"

export default {
  id: "opencode-agent-comms",
  server: async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
    const config = parseConfig(options, input.directory)
    const db = initDb(config.db_path)

    purgeExpired(db)

    const ref = { agents: undefined as Record<string, any> | undefined }

    return {
      config: async (cfg: any) => {
        ref.agents = cfg.agent
      },
      event: createEventHook({ db, config }),
      "experimental.chat.system.transform": createSystemTransformHook({ db, config }),
      tool: {
        agent_list: createAgentListTool(() => ref.agents),
        session_list: createSessionListTool({ client: input.client as any, db, getAgents: () => ref.agents }),
        session_send: createSessionSendTool({ client: input.client as any, db, config, getAgents: () => ref.agents }),
        session_read: createSessionReadTool({ db }),
        session_rename: createSessionRenameTool({ client: input.client as any }),
      },
    }
  },
}
