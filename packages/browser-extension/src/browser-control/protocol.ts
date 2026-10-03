// The Browser Control relay's extension protocol (version 2), ported from anomalyco/browser-control
// src/protocol.ts and src/recording-protocol.ts. OpenCode Browser speaks it so the relay, its CLI, and
// its MCP server drive tabs through this extension. Keep it in step with the relay.

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }

export const extensionProtocolVersion = 2

export type PageStatus = {
  readonly state: "attached" | "running" | "waiting"
  readonly owner: "session" | "user"
  readonly sessionId?: string
  readonly readOnly?: boolean
  readonly message?: string
  readonly handoffId?: string
}

const commandMethods = [
  "ping",
  "debugger.attach",
  "debugger.detach",
  "debugger.sendCommand",
  "tabs.create",
  "tabs.remove",
  "tabs.group",
  "tabs.ungroup",
  "action.setAttached",
  "action.setBadge",
  "pageStatus.set",
  "pageStatus.clear",
  "runtime.reload",
  "profile.rename",
  "recording.start",
  "recording.stop",
  "recording.status",
  "recording.cancel",
] as const

export type ExtensionCommand = {
  readonly id: number
  readonly method: (typeof commandMethods)[number]
  readonly params?: JsonObject
}

export function parseExtensionCommand(input: string): ExtensionCommand {
  const parsed: unknown = JSON.parse(input)
  if (
    !isJsonObject(parsed) ||
    typeof parsed.id !== "number" ||
    typeof parsed.method !== "string" ||
    !(commandMethods as readonly string[]).includes(parsed.method) ||
    (parsed.params !== undefined && !isJsonObject(parsed.params))
  )
    throw new Error("Invalid extension command")
  return parsed as ExtensionCommand
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function pageStatusFromJson(value: unknown): PageStatus | undefined {
  if (!isJsonObject(value)) return undefined
  const state = value.state
  const owner = value.owner
  if ((state !== "attached" && state !== "running" && state !== "waiting") || (owner !== "session" && owner !== "user"))
    return undefined
  const message = value.message
  const handoffId = value.handoffId
  if (state === "waiting" && (typeof message !== "string" || typeof handoffId !== "string")) return undefined
  return {
    state,
    owner,
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(value.readOnly === true ? { readOnly: true } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(typeof handoffId === "string" ? { handoffId } : {}),
  }
}

// Recording data streams to the relay as binary frames: "BCRD", version, flags, header length, tab id,
// sequence, payload length, then the payload. A final frame has an empty payload.
export const maxRecordingFramePayloadBytes = 4 * 1024 * 1024

export function encodeRecordingFrame(frame: { tabId: number; sequence: number; final: boolean; payload: Uint8Array }) {
  if (frame.payload.byteLength > maxRecordingFramePayloadBytes)
    throw new Error(`Recording frame payload exceeds ${maxRecordingFramePayloadBytes} bytes`)
  if (frame.final && frame.payload.byteLength !== 0) throw new Error("Final recording frame must have an empty payload")
  if (!frame.final && frame.payload.byteLength === 0) throw new Error("Recording data frame must have a payload")
  const encoded = new Uint8Array(20 + frame.payload.byteLength)
  encoded.set([0x42, 0x43, 0x52, 0x44], 0)
  const view = new DataView(encoded.buffer)
  view.setUint8(4, 1)
  view.setUint8(5, frame.final ? 1 : 0)
  view.setUint16(6, 20)
  view.setUint32(8, frame.tabId)
  view.setUint32(12, frame.sequence)
  view.setUint32(16, frame.payload.byteLength)
  encoded.set(frame.payload, 20)
  return encoded
}
