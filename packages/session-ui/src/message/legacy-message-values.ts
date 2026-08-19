// Delete this bridge when current message and tool renderers no longer consume presentation.ts.
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import { Option, Schema } from "effect"
import { partDefaultOpen } from "../components/part-default-open"
import type {
  AgentPart,
  AssistantMessage,
  FilePart,
  ReasoningPart,
  TextPart,
  ToolPart,
  UserMessage,
} from "../presentation"
import type { SessionUserComment } from "../actions"

const decodeToolInput = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeToolInput(name: string, input: Record<string, unknown>) {
  if (!["edit", "write"].includes(name) || typeof input.path !== "string" || typeof input.filePath === "string")
    return input
  return { ...input, filePath: input.path }
}

function normalizeToolMetadata(name: string, metadata: Record<string, unknown>) {
  if (name !== "edit" || !Array.isArray(metadata.files)) return metadata
  const file = metadata.files.find(record)
  if (!file || typeof file.file !== "string") return metadata
  return {
    ...metadata,
    filediff: {
      file: file.file,
      patch: typeof file.patch === "string" ? file.patch : undefined,
      additions: typeof file.additions === "number" ? file.additions : 0,
      deletions: typeof file.deletions === "number" ? file.deletions : 0,
    },
  }
}

function contentID(messageID: string, type: "text" | "reasoning", ordinal: number) {
  return `${messageID}:${type}:${ordinal}`
}

export function toLegacyUserMessage(
  sessionID: string,
  message: SessionMessageUser,
  historicalAgent: string,
  historicalModel: SessionMessageAssistant["model"],
): UserMessage {
  return {
    id: message.id,
    sessionID,
    role: "user",
    time: message.time,
    agent: historicalAgent,
    model: { providerID: historicalModel.providerID, modelID: historicalModel.id },
  }
}

export function toLegacyUserParts(
  sessionID: string,
  message: SessionMessageUser,
  displayText?: string,
  comments: SessionUserComment[] = [],
) {
  const text = displayText ?? message.text
  return [
    ...(text ? [toLegacyTextPart(sessionID, message.id, 0, text)] : []),
    ...(message.files ?? []).map(
      (file, index): FilePart => ({
        id: `${message.id}:file:${index}`,
        sessionID,
        messageID: message.id,
        type: "file",
        mime: file.mime,
        filename: file.name,
        url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
        source: file.mention
          ? {
              type: "file",
              text: { value: file.mention.text, start: file.mention.start, end: file.mention.end },
              path: file.mention.text.startsWith("@") ? file.mention.text.slice(1) : file.mention.text,
            }
          : undefined,
      }),
    ),
    ...(message.agents ?? []).map(
      (item, index): AgentPart => ({
        id: `${message.id}:agent:${index}`,
        sessionID,
        messageID: message.id,
        type: "agent",
        name: item.name,
        source: item.mention
          ? { value: item.mention.text, start: item.mention.start, end: item.mention.end }
          : undefined,
      }),
    ),
    ...comments.map(
      (comment, index): TextPart => ({
        id: `${message.id}:comment:${index}`,
        sessionID,
        messageID: message.id,
        type: "text",
        text: formatCommentNote(comment),
        synthetic: true,
        metadata: { opencodeComment: comment },
      }),
    ),
  ]
}

export function toLegacyAssistantMessage(
  sessionID: string,
  parentID: string,
  message: SessionMessageAssistant,
): AssistantMessage {
  const error = message.error
    ? message.error.type.toLowerCase().includes("abort") || message.error.type.toLowerCase().includes("interrupt")
      ? { name: "MessageAbortedError", data: { message: message.error.message } }
      : { name: "UnknownError", data: { message: message.error.message } }
    : undefined
  return {
    id: message.id,
    sessionID,
    role: "assistant",
    time: message.time,
    error,
    parentID,
    modelID: message.model.id,
    providerID: message.model.providerID,
    agent: message.agent,
  }
}

export function toLegacyAssistantParts(sessionID: string, message: SessionMessageAssistant) {
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.flatMap((content): (TextPart | ReasoningPart | ToolPart)[] => {
    const id = content.type === "tool" ? content.id : contentID(message.id, content.type, ordinals[content.type]++)
    const part = toLegacyAssistantContent(sessionID, message, id, content)
    if ((part.type === "text" || part.type === "reasoning") && !part.text.trim()) return []
    return [part]
  })
}

export function toLegacyAssistantContent(
  sessionID: string,
  message: SessionMessageAssistant,
  id: string,
  content: SessionMessageAssistant["content"][number],
) {
  if (content.type === "text")
    return { id, sessionID, messageID: message.id, type: "text", text: content.text } satisfies TextPart
  if (content.type === "reasoning")
    return {
      id,
      sessionID,
      messageID: message.id,
      type: "reasoning",
      text: content.text,
      metadata: content.state,
      time: {
        start: content.time?.created ?? message.time.created,
        end: content.time?.completed,
      },
    } satisfies ReasoningPart
  return toLegacyToolPart(sessionID, message.id, content)
}

export function legacyContentDefaultOpen(
  sessionID: string,
  message: SessionMessageAssistant,
  content: SessionMessageAssistant["content"][number],
  id: string,
  shellExpanded: boolean,
  editExpanded: boolean,
) {
  return partDefaultOpen(toLegacyAssistantContent(sessionID, message, id, content), shellExpanded, editExpanded)
}

function toLegacyTextPart(sessionID: string, messageID: string, ordinal: number, text: string): TextPart {
  return {
    id: contentID(messageID, "text", ordinal),
    sessionID,
    messageID,
    type: "text",
    text,
  }
}

function toLegacyToolPart(sessionID: string, messageID: string, tool: SessionMessageAssistantTool): ToolPart {
  const start = tool.time.ran ?? tool.time.created
  const state = (() => {
    if (tool.state.status === "streaming") {
      const value = Option.getOrUndefined(decodeToolInput(tool.state.input))
      return {
        status: "pending" as const,
        input: normalizeToolInput(tool.name, record(value) ? value : {}),
        raw: tool.state.input,
      }
    }
    if (tool.state.status === "running") {
      return {
        status: "running" as const,
        input: normalizeToolInput(tool.name, tool.state.input),
        metadata: normalizeToolMetadata(tool.name, tool.state.metadata),
        time: { start },
      }
    }
    if (tool.state.status === "error") {
      return {
        status: "error" as const,
        input: normalizeToolInput(tool.name, tool.state.input),
        error: tool.state.error.message,
        metadata: normalizeToolMetadata(tool.name, tool.state.metadata ?? {}),
        time: { start, end: tool.time.completed ?? start },
      }
    }
    const attachments = tool.state.content.flatMap((item, index): FilePart[] =>
      item.type === "file"
        ? [
            {
              id: `${tool.id}:file:${index}`,
              sessionID,
              messageID,
              type: "file",
              mime: item.mime,
              filename: item.name ?? undefined,
              url: item.uri,
            },
          ]
        : [],
    )
    return {
      status: "completed" as const,
      input: normalizeToolInput(tool.name, tool.state.input),
      output: tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"),
      title: tool.name,
      metadata: normalizeToolMetadata(tool.name, tool.state.metadata ?? {}),
      time: { start, end: tool.time.completed ?? start },
      attachments: attachments.length ? attachments : undefined,
    }
  })()
  return {
    id: tool.id,
    sessionID,
    messageID,
    type: "tool",
    callID: tool.id,
    tool: tool.name,
    state,
  }
}

function formatCommentNote(comment: SessionUserComment) {
  const start = comment.selection ? Math.min(comment.selection.startLine, comment.selection.endLine) : undefined
  const end = comment.selection ? Math.max(comment.selection.startLine, comment.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  return `The user made the following comment regarding ${range} of ${comment.path}: ${comment.comment}`
}
