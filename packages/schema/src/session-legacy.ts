export * as SessionLegacy from "./session-legacy.js"

/**
 * Storage and wire compatibility for current-architecture data written before v2.1 (not V1 contracts). Native data
 * was then named `state` or `providerState`, a tool's result native data `resultState` or `providerResultState`,
 * summary compactions stored the text of the messages they kept in `recent`, and provider compactions stored their
 * replacement window in `providerContext`. Stored events, projected messages, and exported transcripts keep whichever
 * shape they were written with, so these upgrade them before decoding.
 */

const renames: Record<string, readonly [string, string]> = {
  "session.text.ended": ["state", "native"],
  "session.reasoning.started": ["state", "native"],
  "session.reasoning.ended": ["state", "native"],
  "session.tool.called": ["state", "native"],
  "session.step.ended": ["providerState", "native"],
  "session.step.failed": ["providerState", "native"],
  "session.tool.success": ["resultState", "native"],
  "session.tool.failed": ["resultState", "native"],
}

/** Upgrades a durable event payload by event type. */
export function event(type: string, data: unknown) {
  if (!isRecord(data)) return data
  if (type === "session.message.content.updated") return content(data)
  // Messages carry a legacy compaction's kept text; its events have no reader for it.
  if (type === "session.compaction.started") return omit(data, "recent")
  if (type === "session.compaction.ended")
    return providerContext(omit(rename(data, "providerState", "native"), "recent"))
  const entry = renames[type]
  return entry ? rename(data, entry[0], entry[1]) : data
}

/** Upgrades a projected message's data by message type. */
export function message(type: unknown, data: Record<string, unknown>) {
  if (type === "assistant") return content(rename(data, "providerState", "native"))
  if (type === "compaction") return providerContext(recent(rename(data, "providerState", "native")))
  return data
}

/** Upgrades complete messages, such as those in an exported session, before decoding. */
export function messages(values: ReadonlyArray<unknown>) {
  return values.map((value) => (isRecord(value) ? message(value.type, value) : value))
}

function content(data: Record<string, unknown>) {
  if (!Array.isArray(data.content)) return data
  return { ...data, content: data.content.map(part) }
}

/** Upgrades an assistant content part written before v2.1. */
export function part(value: unknown) {
  if (!isRecord(value)) return value
  if (value.type === "text" || value.type === "reasoning") return rename(value, "state", "native")
  // A tool part's own `state` is its lifecycle status, not native data.
  if (value.type === "tool") return toolResult(rename(value, "providerState", "native"))
  return value
}

/** Kept text a summary compaction stored before it referenced `metadata.keepID`; replay still reads it. */
function recent(data: Record<string, unknown>) {
  const text = data.recent
  const rest = omit(data, "recent")
  if (typeof text !== "string" || !text) return rest
  const metadata = isRecord(rest.metadata) ? rest.metadata : {}
  return { ...rest, metadata: { recent: text, ...metadata } }
}

/** The window moves to `native.messages`; the `native` stored beside it was never replayed. */
function providerContext(data: Record<string, unknown>) {
  const context = data.providerContext
  const rest = omit(data, "providerContext")
  if (!isRecord(context)) return rest
  return {
    ...rest,
    native: { messages: Array.isArray(context.messages) ? context.messages.map(media) : context.messages },
  }
}

/** Before 2.0.15, window media parts stored `mediaType` and base64 `data` directly. */
function media(message: unknown) {
  if (!isRecord(message) || !Array.isArray(message.content)) return message
  return {
    ...message,
    content: message.content.map((part: unknown) => {
      if (!isRecord(part) || part.type !== "media" || part.media !== undefined || typeof part.data !== "string")
        return part
      const { mediaType, data, ...rest } = part
      return { ...rest, media: { source: { type: "base64", data, mediaType } } }
    }),
  }
}

function omit(value: Record<string, unknown>, key: string) {
  if (!(key in value)) return value
  const { [key]: _, ...rest } = value
  return rest
}

// Result data now merges into the tool's single `native`, as projection does for current result events.
function toolResult(value: Record<string, unknown>) {
  if (!("providerResultState" in value)) return value
  const { providerResultState, ...rest } = value
  if (!isRecord(providerResultState)) return rest
  return { ...rest, native: { ...(isRecord(rest.native) ? rest.native : {}), ...providerResultState } }
}

// The current name wins when a payload carries both.
function rename(value: Record<string, unknown>, from: string, to: string) {
  if (!(from in value)) return value
  const { [from]: moved, ...rest } = value
  return to in rest ? rest : { ...rest, [to]: moved }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
