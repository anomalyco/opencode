import { z } from "zod"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Log } from "../util/log"

const log = Log.create({ service: "model-switch-tool" })

export const ModelSwitchTool = Tool.define("model_switch", {
  description: `Switch the current model to a different one.

Use this tool after the user has selected a model from your recommendations.
This will immediately switch the active model for the current session.

IMPORTANT: Only use this AFTER asking the user which model they want via the question tool.

Parameters:
- provider: The provider ID (e.g., "antigravity", "openai", "anthropic")  
- model: The model ID (e.g., "claude-sonnet-4-5-thinking", "gemini-3-flash")

Example flow:
1. Use question tool to ask user which model they prefer
2. User selects "Claude Opus 4.5"
3. Call this tool with provider="antigravity", model="claude-opus-4-5-thinking"
4. Model switches automatically, continue conversation`,
  parameters: z.object({
    provider: z.string().describe("The provider ID (e.g., antigravity, openai, anthropic)"),
    model: z.string().describe("The model ID to switch to"),
  }),
  async execute({ provider, model }, ctx) {
    log.info("switching model", { provider, model, sessionID: ctx.sessionID })

    // Publish TuiEvent for TUI to pick up
    await Bus.publish(TuiEvent.ModelSwitch, {
      providerID: provider,
      modelID: model,
    })

    return {
      title: `Switched to ${provider}/${model}`,
      output: `Model switched to ${provider}/${model}. The next message will use this model.`,
      metadata: { provider, model },
    }
  },
})
