export * as LiveToolMetadata from "./live-tool-metadata.js"

import type { Tool } from "../../tool.js"
import type { SessionMessage } from "../message.js"

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

export function overlay(message: SessionMessage.Info): SessionMessage.Info
export function overlay(message: SessionMessage.MediaInfo): SessionMessage.MediaInfo
export function overlay(message: SessionMessage.Info | SessionMessage.MediaInfo) {
  if (message.type !== "assistant") return message
  const calls = live.get(message.id)
  if (!calls) return message
  return { ...message, content: message.content.map((part) => overlayPart(part, calls)) }
}

function overlayPart(part: SessionMessage.AssistantContent, calls: Map<string, Tool.Metadata>) {
  if (part.type !== "tool" || part.state.status !== "running") return part
  const metadata = calls.get(part.id)
  if (metadata === undefined) return part
  return { ...part, state: { ...part.state, metadata: { ...part.state.metadata, ...metadata } } }
}
