import z from "zod"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import type { ModelMessage } from "ai"

export namespace SessionContext {
  export const RawContext = z.object({
    system: z.array(z.string()),
    messages: z.array(z.any()),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    agent: z.string(),
  })
  export type RawContext = z.infer<typeof RawContext>

  export async function build(sessionID: string): Promise<RawContext> {
    const session = await Session.get(sessionID)
    const msgs = await Session.messages({ sessionID })

    // Find the last user message to get agent and model info
    let agentName = await Agent.defaultAgent()
    let model = await Provider.defaultModel()

    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i].info
      if (info.role === "user") {
        agentName = info.agent || agentName
        model = info.model || model
        break
      }
    }

    const agent = await Agent.get(agentName)
    const modelInfo = await Provider.getModel(model.providerID, model.modelID)

    // Build system prompts
    const system: string[] = []
    const header = SystemPrompt.header(model.providerID)
    system.push(...header)

    const agentPrompt = agent.prompt ? [agent.prompt] : SystemPrompt.provider(modelInfo)
    const envPrompt = await SystemPrompt.environment(modelInfo)
    const customPrompt = await SystemPrompt.custom()

    system.push([...agentPrompt, ...envPrompt, ...customPrompt].filter((x) => x).join("\n"))

    // Convert messages to model format
    const modelMessages = MessageV2.toModelMessages(msgs, modelInfo)

    return {
      system,
      messages: modelMessages,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      agent: agentName,
    }
  }
}
