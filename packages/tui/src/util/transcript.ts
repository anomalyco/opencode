import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "./locale"
import * as Model from "./model"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
  mode?: "native" | "web"
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  const providers = Model.index(options.providers)
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    const value = formatMessage(msg.info, msg.parts, options, providers)
    if (!value.trim()) continue
    transcript += value
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  msg: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  const visible = parts.filter((part, index) => isPartVisible(part, msg.role, options, index))
  if (!visible.length) return ""

  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers)
  }

  for (const part of visible) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(
  msg: AssistantMessage,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  const modelName = Model.name(providers, msg.providerID, msg.modelID)

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  return ""
}

export function isPartVisible(
  part: Part,
  role: UserMessage["role"] | AssistantMessage["role"],
  options: TranscriptOptions,
  index: number,
): boolean {
  if (part.type === "step-start") return options.mode !== "web" || (role === "assistant" && index === 0)
  if (part.type === "snapshot") return options.mode !== "web"
  if (part.type === "patch") return options.mode !== "web"
  if (part.type === "step-finish") return options.mode !== "web"

  if (part.type === "text") {
    if (part.synthetic) return false
    if (part.ignored) return false
    if (options.mode === "web" && !part.text) return false
    return true
  }

  if (part.type === "reasoning") {
    if (!options.thinking) return false
    if (options.mode === "web" && !part.text) return false
    return true
  }

  if (part.type === "tool") {
    if (options.mode === "web" && part.state.status === "pending") return false
    if (options.mode === "web" && part.state.status === "running") return false
    return true
  }

  if (part.type === "file") return true
  if (part.type === "compaction") return true
  return false
}
