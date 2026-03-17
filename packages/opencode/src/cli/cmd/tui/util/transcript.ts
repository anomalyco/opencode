import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"

/**
 * Options for formatting a transcript.
 */
export type TranscriptOptions = {
  /** Whether to include thinking/reasoning content in the output */
  thinking: boolean
  /** Whether to include detailed tool input/output information */
  toolDetails: boolean
  /** Whether to include assistant metadata (agent, model, duration) */
  assistantMetadata: boolean
}

/**
 * Information about a session for transcript formatting.
 */
export type SessionInfo = {
  /** The unique identifier for the session */
  id: string
  /** The title of the session */
  title: string
  /** Timestamps for session creation and last update */
  time: {
    /** Unix timestamp when the session was created */
    created: number
    /** Unix timestamp when the session was last updated */
    updated: number
  }
}

/**
 * A message combined with its parts for transcript formatting.
 */
export type MessageWithParts = {
  /** The message metadata (user or assistant) */
  info: UserMessage | AssistantMessage
  /** The parts that make up the message content */
  parts: Part[]
}

/**
 * Formats a complete session transcript with all messages.
 *
 * Generates a markdown-formatted transcript including session metadata
 * and all messages with their parts.
 *
 * @param session - The session information
 * @param messages - Array of messages with their parts
 * @param options - Formatting options for the transcript
 * @returns The formatted transcript as a markdown string
 * @example
 * ```typescript
 * const transcript = formatTranscript(session, messages, {
 *   thinking: true,
 *   toolDetails: true,
 *   assistantMetadata: true
 * })
 * ```
 */
export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

/**
 * Formats a single message with its parts.
 *
 * Handles both user and assistant messages, applying appropriate formatting
 * based on the message role and options.
 *
 * @param msg - The message to format (user or assistant)
 * @param parts - The parts that make up the message content
 * @param options - Formatting options
 * @returns The formatted message as a markdown string
 */
export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

/**
 * Formats the header for an assistant message.
 *
 * When metadata is enabled, includes the agent name, model ID, and response duration.
 * Otherwise, returns a simple "Assistant" header.
 *
 * @param msg - The assistant message
 * @param includeMetadata - Whether to include metadata in the header
 * @returns The formatted assistant header
 */
export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

/**
 * Formats a single part of a message.
 *
 * Handles different part types: text, reasoning/thinking, and tool calls.
 * Text parts are included directly, reasoning parts are optional based on settings,
 * and tool parts include detailed input/output information when enabled.
 *
 * @param part - The part to format
 * @param options - Formatting options
 * @returns The formatted part as a markdown string
 */
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
