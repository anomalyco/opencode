import { Predicate } from "effect"
import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"

/**
 * Tool names that spawn a child session. `subagent` is the current name;
 * `task` only survives inside transcripts migrated from V1, whose migration
 * keeps the original tool name.
 */
export const subagentToolNames = ["subagent", "task"] as const

/** What a parent session's subagent tool part reports for one child session. */
export type SubagentTaskStatus = "running" | "completed" | "cancelled" | "error"

/**
 * One subagent tool call found in a parent transcript.
 */
export interface SubagentCall {
  /** The tool call id. */
  readonly partID: string
  /** The spawned child session, once the runner assigned one. */
  readonly childID: string | undefined
  /** The tool input description, if any. */
  readonly description: string | undefined
  /** The requested agent, if any. */
  readonly agent: string | undefined
  /** The call's own wire state. */
  readonly status: "streaming" | "running" | "completed" | "error"
  /** Completed while the child keeps running. */
  readonly backgrounded: boolean
  /** Inside the latest uncompleted assistant message. */
  readonly live: boolean
  /** The underlying tool part. */
  readonly part: SessionMessageAssistantTool
}

/**
 * A parent transcript scanned for subagent work. Both the header's background
 * reader and the agents panel compose this instead of reimplementing the
 * notice, liveness and backgrounded checks.
 */
export interface SubagentTranscript {
  /** Every matching tool call in transcript order. Streaming calls carry no metadata yet, so they never join. */
  readonly calls: readonly SubagentCall[]
  /** Child ids with a synthetic completion notice. */
  readonly completed: ReadonlySet<string>
  /** The latest assistant message still running, if any. */
  readonly live: SessionMessageAssistant | undefined
}

/**
 * Trimmed text or undefined for blank and non-string wire values.
 *
 * @param value - A metadata or input value from the wire.
 */
export function text(value: JsonValue | undefined): string | undefined {
  if (!Predicate.isString(value)) return undefined

  const trimmed = value.trim()

  if (!trimmed) return undefined

  return trimmed
}

/**
 * The child session id a tool part spawned, accepting both metadata key spellings.
 *
 * @param part - A subagent tool part.
 */
export function toolSessionID(part: SessionMessageAssistantTool): string | undefined {
  return text(toolMetadata(part, "sessionID")) ?? text(toolMetadata(part, "sessionId"))
}

/**
 * The task description of a tool part, if it carries one.
 *
 * @param part - A subagent tool part.
 */
export function toolDescription(part: SessionMessageAssistantTool): string | undefined {
  if (!("input" in part.state) || Predicate.isString(part.state.input)) return undefined

  return text(part.state.input.description)
}

/**
 * The requested agent of a tool part, if it carries one.
 *
 * @param part - A subagent tool part.
 */
export function toolAgent(part: SessionMessageAssistantTool): string | undefined {
  if (!("input" in part.state) || Predicate.isString(part.state.input)) return undefined

  return text(part.state.input.agent)
}

/**
 * Whether a completed part left its child running in the background.
 *
 * @param part - A subagent tool part.
 */
export function partBackgrounded(part: SessionMessageAssistantTool): boolean {
  if (part.state.status !== "completed" || !("metadata" in part.state)) return false

  return part.state.metadata?.status === "running"
}

/**
 * The state one child session is in from its parent tool part. A completed part
 * is done; an error part is only a cancellation when the runner marked it
 * interrupted or aborted, mirroring core's structured abort errors.
 *
 * @param part - A subagent tool part.
 */
export function taskStatus(part: SessionMessageAssistantTool): SubagentTaskStatus {
  if (part.state.status === "completed") return "completed"

  if (part.state.status === "error") {
    if (toolMetadata(part, "interrupted") === true) return "cancelled"

    if (part.state.error.type === "aborted") return "cancelled"

    return "error"
  }

  return "running"
}

function toolMetadata(part: SessionMessageAssistantTool, key: string): JsonValue | undefined {
  if (!("metadata" in part.state)) return undefined

  return part.state.metadata?.[key]
}

/**
 * Scans a parent transcript for subagent work: completion notices, the latest
 * uncompleted assistant message, and every matching tool call with its child,
 * description, liveness and backgrounded flags resolved.
 *
 * @param messages - The parent session's messages in transcript order.
 * @param names - Tool names that spawn a child session.
 */
export function scanSubagentTranscript(
  messages: SessionMessageInfo[],
  names: readonly string[] = subagentToolNames,
): SubagentTranscript {
  const completed = new Set<string>()
  let live: SessionMessageAssistant | undefined

  for (const message of messages) {
    if (message.type === "synthetic") {
      if (message.metadata?.source === "subagent") {
        const childID = text(message.metadata?.childID)

        if (childID) completed.add(childID)
      }

      continue
    }

    if (message.type !== "assistant" || message.time.completed !== undefined) continue

    live = message
  }

  const calls: SubagentCall[] = []

  for (const message of messages) {
    if (message.type !== "assistant") continue

    for (const part of message.content) {
      if (part.type !== "tool" || !names.includes(part.name)) continue

      if (part.state.status === "streaming") continue

      calls.push({
        partID: part.id,
        childID: toolSessionID(part),
        description: toolDescription(part),
        agent: toolAgent(part),
        status: part.state.status,
        backgrounded: partBackgrounded(part),
        live: message === live,
        part,
      })
    }
  }

  return { calls, completed, live }
}
