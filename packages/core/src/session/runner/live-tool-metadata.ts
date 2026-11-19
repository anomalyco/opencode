import type { Tool } from "../../tool.js"

/**
 * Latest progress metadata of locally running tool calls, keyed by assistant message and call id.
 * Progress is only published as an ephemeral event, so message reads overlay it onto running tool
 * parts; this keeps clients that load a session mid-call from seeing empty metadata.
 */
const live = new Map<string, Map<string, Tool.Metadata>>()

export function set(messageID: string, callID: string, metadata: Tool.Metadata) {
  const calls = live.get(messageID) ?? new Map<string, Tool.Metadata>()
  calls.set(callID, metadata)
  live.set(messageID, calls)
}

export function clear(messageID: string, callID?: string) {
  if (callID === undefined) return void live.delete(messageID)
  const calls = live.get(messageID)
  if (!calls) return
  calls.delete(callID)
  if (calls.size === 0) live.delete(messageID)
}

type Readable = { readonly type: string; readonly id: string; readonly content?: ReadonlyArray<unknown> }

export function overlay<T extends Readable>(message: T): T {
  if (message.type !== "assistant") return message
  const calls = live.get(message.id)
  if (!calls || !message.content) return message
  let changed = false
  const content = message.content.map((part) => {
    const tool = part as { type?: string; id?: string; state?: { status?: string; metadata?: object } }
    if (tool.type !== "tool" || tool.state?.status !== "running" || tool.id === undefined) return part
    const metadata = calls.get(tool.id)
    if (metadata === undefined) return part
    changed = true
    return { ...tool, state: { ...tool.state, metadata: { ...tool.state.metadata, ...metadata } } }
  })
  return changed ? { ...message, content } : message
}
