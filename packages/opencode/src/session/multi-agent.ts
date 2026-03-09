import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { LLM } from "./llm"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "multi-agent" })

export interface MultiAgentResult {
  primary: MessageV2.Assistant
  responses: Map<string, string>
}

export async function executeMultiAgent(params: {
  sessionID: string
  agentName: string
  userMessage: MessageV2.User
  messages: any[]
  model: Provider.Model
  abort: AbortSignal
  tools: Record<string, any>
}): Promise<MultiAgentResult | null> {
  const { sessionID, agentName, userMessage, messages, model: primaryModel, abort, tools } = params

  const agent = await Agent.get(agentName)
  if (!agent) return null

  const multiConfig = agent.multiAgent
  const models = agent.models

  if (!multiConfig?.enabled || !models || models.length === 0) {
    return null
  }

  log.info("Executing multi-agent parallel workflow", {
    sessionID,
    agentName,
    modelCount: models.length + 1,
    parallel: multiConfig.parallel,
  })

  const primaryAssistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    parentID: userMessage.id,
    role: "assistant",
    sessionID,
    mode: agentName,
    agent: agentName,
    variant: userMessage.variant,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: primaryModel.id,
    providerID: primaryModel.providerID,
    time: {
      created: Date.now(),
    },
  }

  await Session.updateMessage(primaryAssistant)

  const reasoningModel = models.find(m => m.role === "reasoning")
  const codingModel = models.find(m => m.role === "coding")
  const assistantModels = models.filter(m => m.role === "assistant")

  const modelPromises: Promise<{ model: Provider.Model; role: string }>[] = []
  
  if (reasoningModel && reasoningModel.modelID !== primaryModel.id) {
    modelPromises.push(
      Provider.getModel(reasoningModel.providerID, reasoningModel.modelID).then(m => ({ model: m, role: reasoningModel.role }))
    )
  }
  
  if (codingModel && codingModel.modelID !== primaryModel.id) {
    modelPromises.push(
      Provider.getModel(codingModel.providerID, codingModel.modelID).then(m => ({ model: m, role: codingModel.role }))
    )
  }
  
  for (const m of assistantModels) {
    if (m.modelID !== primaryModel.id) {
      modelPromises.push(
        Provider.getModel(m.providerID, m.modelID).then(model => ({ model, role: m.role }))
      )
    }
  }

  const allModels = await Promise.all(modelPromises)
  const responses = new Map<string, string>()

  if (multiConfig.parallel) {
    const parallelPromises = allModels.map(async ({ model, role }) => {
      try {
        const response = await runModelParallel({
          model,
          role,
          sessionID,
          userMessage,
          messages,
          abort,
          tools,
        })
        responses.set(role, response)
        log.info("Parallel model completed", { role, modelId: model.id })
        return { role, response }
      } catch (error) {
        log.error("Parallel model failed", { role, error })
        return { role, response: "" }
      }
    })

    await Promise.all(parallelPromises)
  } else {
    for (const { model, role } of allModels) {
      try {
        const response = await runModelParallel({
          model,
          role,
          sessionID,
          userMessage,
          messages,
          abort,
          tools,
        })
        responses.set(role, response)
      } catch (error) {
        log.error("Model failed", { role, error })
      }
    }
  }

  return {
    primary: primaryAssistant,
    responses,
  }
}

async function runModelParallel(params: {
  model: Provider.Model
  role: string
  sessionID: string
  userMessage: MessageV2.User
  messages: any[]
  abort: AbortSignal
  tools: Record<string, any>
}): Promise<string> {
  const { model, role, sessionID, userMessage, messages, abort, tools } = params

  const assistantMessage: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    parentID: userMessage.id,
    role: "assistant",
    sessionID,
    mode: role,
    agent: `multi-${role}`,
    variant: userMessage.variant,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.id,
    providerID: model.providerID,
    time: {
      created: Date.now(),
    },
  }

  await Session.updateMessage(assistantMessage)

  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantMessage.id,
    sessionID,
    type: "text",
    text: `[Multi-agent ${role} model: ${model.id}]`,
    synthetic: true,
  } as any)

  try {
    const streamResult = await LLM.stream({
      agent: { name: role } as any,
      user: userMessage,
      system: [],
      tools,
      model,
      abort,
      sessionID,
      messages: messages.map((m: any) => ({
        role: m.info.role,
        content: m.parts.map((p: any) => p.type === "text" ? p.text : "").join(""),
      })),
      retries: 0,
    })

    let fullResponse = ""
    for await (const chunk of streamResult.fullStream) {
      if (chunk.type === "text-delta") {
        fullResponse += chunk.text
      }
    }

    assistantMessage.finish = "stop"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)

    return fullResponse
  } catch (error) {
    log.error("Parallel model stream failed", { role, error })
    assistantMessage.finish = "error"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)
    return ""
  }
}

export function mergeMultiAgentResponses(params: {
  primary: MessageV2.Assistant
  responses: Map<string, string>
  strategy: "primary-wins" | "reasoning-wins" | "all-responses"
}): string {
  const { responses, strategy } = params

  switch (strategy) {
    case "reasoning-wins": {
      const reasoning = responses.get("reasoning")
      if (reasoning) return reasoning
      const coding = responses.get("coding")
      if (coding) return coding
      return Array.from(responses.values()).join("\n\n")
    }
    case "primary-wins": {
      return Array.from(responses.values()).join("\n\n")
    }
    case "all-responses":
    default: {
      const parts: string[] = []
      for (const [role, response] of responses) {
        if (response) {
          parts.push(`[${role.toUpperCase()}]: ${response}`)
        }
      }
      return parts.join("\n\n---\n\n")
    }
  }
}
