type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = { readonly [key: string]: JsonValue }

export const extensionProtocolVersion = 2

/**
 * Chrome's minimum alarm period. A disconnected extension's MV3 worker sleeps
 * until this alarm fires, so relay clients must wait at least this long.
 */
export const extensionReconnectAlarmPeriodMs = 30_000
const legacyExtensionProtocolVersion = 1

export type ExtensionProtocolCompatibility = {
  readonly version: number | null
  readonly compatible: boolean
  readonly legacy: boolean
}

export function extensionProtocolCompatibility(value: JsonValue | undefined): ExtensionProtocolCompatibility {
  const legacy = value === undefined
  const valid = typeof value === "number" && Number.isSafeInteger(value) && value > 0
  const version = valid ? value : legacy ? legacyExtensionProtocolVersion : null
  return { version, compatible: version === extensionProtocolVersion, legacy }
}

export type CdpRequest = {
  readonly id: number
  readonly method: string
  readonly params?: JsonObject
  readonly sessionId?: string
}

export type CdpResponse = {
  readonly id: number
  readonly result?: JsonObject
  readonly error?: {
    readonly message: string
  }
  readonly sessionId?: string
}

export type CdpEvent = {
  readonly method: string
  readonly params?: JsonObject
  readonly sessionId?: string
}

export type TargetInfo = {
  readonly targetId: string
  readonly type: "page" | "iframe" | "worker"
  readonly title: string
  readonly url: string
  readonly attached: boolean
  readonly canAccessOpener: boolean
  readonly browserContextId?: string
  readonly openerId?: string
  readonly parentFrameId?: string
}

export type PageStatus = {
  readonly state: "attached" | "running" | "waiting"
  readonly owner: "session" | "user"
  readonly sessionId?: string
  readonly readOnly?: boolean
  readonly message?: string
  readonly handoffId?: string
}

export function makePageStatus(options: {
  readonly state: PageStatus["state"]
  readonly targetOwner: "relay" | "user"
  readonly sessionId?: string
  readonly readOnly?: boolean
  readonly message?: string
  readonly handoffId?: string
}): PageStatus {
  return {
    state: options.state,
    owner: options.targetOwner === "user" ? "user" : "session",
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.sessionId && options.readOnly ? { readOnly: true } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.handoffId ? { handoffId: options.handoffId } : {}),
  }
}

const extensionCommandMethodValues = [
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
  "recording.start",
  "recording.stop",
  "recording.status",
  "recording.cancel",
  "tabs.cleanup",
] as const

const extensionEventMethodValues = [
  "hello",
  "ready",
  "toolbar.clicked",
  "handoff.completed",
  "debugger.event",
  "debugger.attached",
  "debugger.detached",
  "tabs.removed",
  "pong",
  "log",
  "recording.cancelled",
  "pageStatus.requested",
] as const

type ExtensionCommandMethod = typeof extensionCommandMethodValues[number]
type ExtensionEventMethod = typeof extensionEventMethodValues[number]

export type ExtensionCommand = {
  readonly id: number
  readonly method: ExtensionCommandMethod
  readonly params?: JsonObject
}

export type ExtensionResponse = {
  readonly id: number
  readonly result?: JsonObject
  readonly error?: string
}

export type ExtensionEvent = {
  readonly method: ExtensionEventMethod
  readonly params?: JsonObject
}

export function parseJsonObject(input: string): JsonObject {
  const parsed: unknown = JSON.parse(input)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object")
  }
  return parsed as JsonObject
}

const extensionCommandMethods = new Set<string>(extensionCommandMethodValues)

const extensionEventMethods = new Set<string>(extensionEventMethodValues)

export function parseExtensionCommand(input: string): ExtensionCommand {
  const parsed = parseJsonObject(input)
  if (
    typeof parsed.id !== "number" ||
    typeof parsed.method !== "string" ||
    !extensionCommandMethods.has(parsed.method) ||
    (parsed.params !== undefined && !isJsonObject(parsed.params))
  ) {
    throw new Error("Invalid extension command")
  }
  return parsed as ExtensionCommand
}

export function isCdpRequest(input: JsonObject): input is CdpRequest {
  return typeof input.id === "number" &&
    typeof input.method === "string" &&
    (input.params === undefined || isJsonObject(input.params)) &&
    (input.sessionId === undefined || typeof input.sessionId === "string")
}

export function isExtensionResponse(input: JsonObject): input is ExtensionResponse {
  return typeof input.id === "number" &&
    (input.result === undefined || isJsonObject(input.result)) &&
    (input.error === undefined || typeof input.error === "string") &&
    !(input.result !== undefined && input.error !== undefined)
}

export function isExtensionEvent(input: JsonObject): input is ExtensionEvent {
  return typeof input.method === "string" &&
    extensionEventMethods.has(input.method) &&
    (input.params === undefined || isJsonObject(input.params))
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
