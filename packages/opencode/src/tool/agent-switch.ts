import { z } from "zod"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Log } from "../util/log"

const log = Log.create({ service: "agent-switch-tool" })

export const AgentSwitchTool = Tool.define("agent_switch", {
  description: `Switch to a different agent.

Use this tool to programmatically switch agents without requiring the user to press Tab.
This is useful for multi-agent workflows where one agent hands off to another.

Parameters:
- agent: The agent name or key (e.g., "Build", "Brain", "Plan")

Example flow:
1. Plan agent finishes gathering requirements
2. Plan calls agent_switch({ agent: "Brain" })
3. Brain agent takes over automatically`,
  parameters: z.object({
    agent: z.string().describe("The agent name or key to switch to (e.g., Build, Brain, Plan)"),
  }),
  async execute({ agent }, ctx) {
    log.info("switching agent", { agent, sessionID: ctx.sessionID })

    // Publish TuiEvent for TUI to pick up
    await Bus.publish(TuiEvent.AgentSwitch, {
      agent,
    })

    return {
      title: `Switched to ${agent}`,
      output: `Agent switched to ${agent}. The next message will use this agent.`,
      metadata: { agent },
    }
  },
})
