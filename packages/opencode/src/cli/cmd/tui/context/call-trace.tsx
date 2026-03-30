import { createSimpleContext } from "./helper"
import { useSync } from "./sync"
import type {
  Part,
  ToolPart,
  StepFinishPart,
  AgentPart,
  SubtaskPart,
  TextPart,
  UserMessage,
  AssistantMessage,
  Message,
} from "@opencode-ai/sdk/v2"

export type TraceSource = "llm" | "tool" | "omo" | "unknown"
export type TraceStatus = "pending" | "running" | "completed" | "error"
export type TraceCategory = "user" | "opencode" | "llm" | "plugin"

export interface CallTraceItem {
  id: string
  type: string
  source: TraceSource
  category: TraceCategory
  name: string
  component: string
  startTime: number
  endTime?: number
  duration?: number
  status: TraceStatus
  metadata?: Record<string, unknown>
  providerID?: string
  modelID?: string
  tokens?: { input: number; output: number }
  cost?: number
  toolName?: string
  input?: string
  output?: string
  agentName?: string
  description?: string
  sessionID?: string
  messageID?: string
}

export function partToTrace(part: Part): CallTraceItem | null {
  const base = {
    id: part.id,
    component: part.type,
    sessionID: part.sessionID,
    messageID: part.messageID,
  }

  if (part.type === "tool") {
    const tool = part as ToolPart
    const state = tool.state
    const status: TraceStatus =
      state.status === "pending"
        ? "pending"
        : state.status === "running"
          ? "running"
          : state.status === "error"
            ? "error"
            : "completed"

    return {
      ...base,
      type: "tool",
      source: "tool",
      category: "opencode",
      name: tool.tool,
      toolName: tool.tool,
      status,
      startTime: "time" in state ? state.time.start : Date.now(),
      endTime: "time" in state && "end" in state.time ? state.time.end : undefined,
      duration: "time" in state && "end" in state.time ? state.time.end - state.time.start : undefined,
      input: "input" in state ? JSON.stringify(state.input) : undefined,
      output: "output" in state ? state.output : undefined,
    }
  }

  if (part.type === "agent") {
    const agent = part as AgentPart
    return {
      ...base,
      type: "omo",
      source: "omo",
      category: "plugin",
      name: agent.name,
      agentName: agent.name,
      status: "completed",
      startTime: Date.now(),
    }
  }

  if (part.type === "subtask") {
    const subtask = part as SubtaskPart
    return {
      ...base,
      type: "omo",
      source: "omo",
      category: "plugin",
      name: subtask.agent,
      agentName: subtask.agent,
      description: subtask.description,
      status: "completed",
      startTime: Date.now(),
      input: subtask.prompt,
    }
  }

  return null
}

export function messageToLLMTrace(msg: Message, userText?: string, assistantText?: string): CallTraceItem | null {
  if (msg.role !== "assistant") return null
  const assistant = msg as AssistantMessage

  return {
    id: `llm-${assistant.id}`,
    type: "llm",
    source: "llm",
    category: "llm",
    name: `${assistant.providerID}/${assistant.modelID}`,
    component: "llm",
    status: "completed",
    startTime: assistant.time.created,
    endTime: assistant.time.completed,
    duration: assistant.time.completed ? assistant.time.completed - assistant.time.created : undefined,
    providerID: assistant.providerID,
    modelID: assistant.modelID,
    tokens: assistant.tokens ? { input: assistant.tokens.input, output: assistant.tokens.output } : undefined,
    cost: assistant.cost,
    input: userText,
    output: assistantText,
    sessionID: assistant.sessionID,
    messageID: assistant.id,
  }
}

export interface CategorizedTraces {
  user: CallTraceItem[]
  opencode: CallTraceItem[]
  llm: CallTraceItem[]
  plugin: CallTraceItem[]
}

export const { use: useCallTrace, provider: CallTraceProvider } = createSimpleContext({
  name: "CallTrace",
  init: () => {
    const sync = useSync()

    const traces = (sessionID: string): CallTraceItem[] => {
      const messages = sync.data.message[sessionID] ?? []
      const result: CallTraceItem[] = []

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const parts = sync.data.part[msg.id] ?? []

        if (msg.role === "user") {
          const textParts = parts.filter((p) => p.type === "text") as TextPart[]
          for (const tp of textParts) {
            if (!tp.synthetic) {
              result.push({
                id: tp.id,
                type: "user",
                source: "unknown",
                category: "user",
                name: "User",
                component: "text",
                status: "completed",
                startTime: tp.time?.start ?? Date.now(),
                input: tp.text,
                messageID: msg.id,
                sessionID: tp.sessionID,
              })
            }
          }
        }

        if (msg.role === "assistant") {
          const textParts = parts.filter((p) => p.type === "text" && !p.synthetic && !p.ignored) as TextPart[]
          const assistantText = textParts.map((tp) => tp.text).join("")

          let userText = ""
          if (i > 0 && messages[i - 1].role === "user") {
            const prevParts = sync.data.part[messages[i - 1].id] ?? []
            const prevTextParts = prevParts.filter((p) => p.type === "text" && !p.synthetic && !p.ignored) as TextPart[]
            userText = prevTextParts.map((tp) => tp.text).join("")
          }

          const llmTrace = messageToLLMTrace(msg, userText, assistantText)
          if (llmTrace) result.push(llmTrace)
        }

        for (const part of parts) {
          if (part.type === "tool" || part.type === "agent" || part.type === "subtask") {
            const trace = partToTrace(part)
            if (trace) result.push(trace)
          }
        }
      }

      return result
    }

    const categorized = (sessionID: string): CategorizedTraces => {
      const all = traces(sessionID)
      return {
        user: all.filter((t) => t.category === "user"),
        opencode: all.filter((t) => t.category === "opencode"),
        llm: all.filter((t) => t.category === "llm"),
        plugin: all.filter((t) => t.category === "plugin"),
      }
    }

    return {
      traces,
      categorized,
    }
  },
})
