export * as GoogleAntigravityWire from "./wire"

import type { ModelEditor } from "@opencode/plugin/effect/model"
import type { ProviderEditor } from "@opencode/plugin/effect/provider"
import { Model, Provider } from "@opencode/plugin/effect"
import { createHash, randomUUID } from "node:crypto"
import { Option, Schema } from "effect"
import { GoogleAntigravityOAuth } from "./oauth"

export const generateURL = `${GoogleAntigravityOAuth.cloudCodeEndpoint}/v1internal:streamGenerateContent?alt=sse`
export const defaultModelID = Model.ID.make("gemini-3.8-flash-high")
export const googleProviderID = Provider.ID.google

const FLASH_LIMIT = { context: 1_048_576, output: 65_536 }

export type ShippedModel = {
  id: string
  name: string
  apiID?: string
  modelEnum?: string
}

export const shippedModels: readonly ShippedModel[] = [
  { id: "gemini-4-carbon-high", name: "Gemini 4 Carbon (High)", modelEnum: "MODEL_PLACEHOLDER_M427" },
  { id: "gemini-4-carbon-medium", name: "Gemini 4 Carbon (Medium)", modelEnum: "MODEL_PLACEHOLDER_M437" },
  { id: "gemini-4-carbon-low", name: "Gemini 4 Carbon (Low)", modelEnum: "MODEL_PLACEHOLDER_M438" },
  { id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)", modelEnum: "MODEL_PLACEHOLDER_M417" },
  { id: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)", modelEnum: "MODEL_PLACEHOLDER_M418" },
  { id: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)", modelEnum: "MODEL_PLACEHOLDER_M419" },
  { id: "gemini-4-hydrogen-xhigh", name: "Gemini 4 Hydrogen (XHigh)", modelEnum: "MODEL_PLACEHOLDER_M528" },
  { id: "gemini-4-hydrogen-high", name: "Gemini 4 Hydrogen (High)", modelEnum: "MODEL_PLACEHOLDER_M525" },
  { id: "gemini-4-hydrogen-medium", name: "Gemini 4 Hydrogen (Medium)", modelEnum: "MODEL_PLACEHOLDER_M526" },
  { id: "gemini-4-hydrogen-low", name: "Gemini 4 Hydrogen (Low)", modelEnum: "MODEL_PLACEHOLDER_M527" },
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", modelEnum: "MODEL_PLACEHOLDER_M318" },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", modelEnum: "MODEL_PLACEHOLDER_M319" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", modelEnum: "MODEL_PLACEHOLDER_M320" },
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", modelEnum: "MODEL_PLACEHOLDER_M298" },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", modelEnum: "MODEL_PLACEHOLDER_M299" },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", modelEnum: "MODEL_PLACEHOLDER_M300" },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
  { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
  { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)" },
  { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)" },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", apiID: "gemini-pro-agent" },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
]

const shippedIDs = new Set(shippedModels.map((model) => model.id))
const aliases: Record<string, string> = { "gemini-3.1-pro-high": "gemini-pro-agent" }

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const modelEnumDefaults = new Map(
  shippedModels.flatMap((model) => (model.modelEnum ? [[model.id, model.modelEnum] as const] : [])),
)

export const catalogID = (id: string) => aliases[id] ?? id

export const isGenerateURL = (url: string) => url.includes("streamGenerateContent") || url.includes("generateContent")

export const modelFromURL = (url: string) => {
  const match = url.match(/\/models\/([^/:?]+)/)
  return match?.[1]
}

export const isBlockedModelID = (id: string) => {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude") || lower.startsWith("gpt") || lower.includes("gpt-oss")) return true
  if (lower.startsWith("tab_") || lower.startsWith("chat_")) return true
  if (lower.includes("image") || lower.endsWith("-disabled")) return true
  return false
}

export const isGoogleCatalogModel = (model: GoogleAntigravityOAuth.CatalogModel) => {
  if (model.internal || model.disabled) return false
  if (isBlockedModelID(model.id)) return false
  if (model.provider && model.provider !== "MODEL_PROVIDER_GOOGLE") return false
  return true
}

export const filterGoogleModels = (models: readonly GoogleAntigravityOAuth.CatalogModel[]) =>
  models.filter(isGoogleCatalogModel)

export function disabledModelsFrom(models: readonly GoogleAntigravityOAuth.CatalogModel[]): ReadonlySet<string> {
  const disabled = new Set<string>()
  for (const model of models) {
    if (model.internal) continue
    if (model.provider && model.provider !== "MODEL_PROVIDER_GOOGLE") continue
    const suffix = model.id.toLowerCase().endsWith("-disabled")
    if (!model.disabled && !suffix) continue
    const base = suffix ? model.id.slice(0, -"-disabled".length) : model.id
    if (!base) continue
    disabled.add(model.id)
    disabled.add(base)
    for (const shipped of shippedModels) {
      const api = catalogID(shipped.id)
      if (
        shipped.id === model.id ||
        shipped.id === base ||
        shipped.id.startsWith(`${base}-`) ||
        api === model.id ||
        api === base ||
        api.startsWith(`${base}-`)
      ) {
        disabled.add(shipped.id)
      }
    }
  }
  return disabled
}

export function modelEnumsFrom(models: readonly GoogleAntigravityOAuth.CatalogModel[]) {
  const disabled = disabledModelsFrom(models)
  const next = new Map(modelEnumDefaults)
  for (const model of filterGoogleModels(models)) {
    if (model.modelEnum) next.set(model.id, model.modelEnum)
  }
  for (const id of disabled) {
    next.delete(id)
  }
  return next
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Strips JSON Schema keywords Cloud Code rejects. Known limitation: a `$ref` is dropped rather
 * than resolved, so a tool parameter defined only by reference degrades to untyped.
 */
export function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (key === "$ref" || key === "$defs" || key === "$schema" || key === "default") continue
    if (key === "const") {
      result.enum = [cleanSchema(value[key])]
      continue
    }
    result[key] = cleanSchema(value[key])
  }
  return result
}

function cleanTool(tool: unknown) {
  if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) return tool
  return {
    ...tool,
    functionDeclarations: tool.functionDeclarations.map((declaration) => {
      if (!isRecord(declaration) || !("parameters" in declaration)) return declaration
      return { ...declaration, parameters: cleanSchema(declaration.parameters) }
    }),
  }
}

function withSystemRole(systemInstruction: unknown) {
  if (!isRecord(systemInstruction)) return systemInstruction
  return { role: "user", ...systemInstruction }
}

function sessionNumber(sessionID: string) {
  // Unsigned: a signed read yields a negative id for half of all Session IDs.
  return String(createHash("sha256").update(sessionID).digest().readBigUInt64BE(0))
}

function safeSession(sessionID: string) {
  return sessionID.replace(/[^a-zA-Z0-9_-]/g, "") || "session"
}

export function wrapGenerateRequest(input: {
  body: unknown
  projectId: string
  model: string
  sessionID: string
  modelEnum?: string
  now?: number
  trajectory?: string
}) {
  if (isRecord(input.body) && isRecord(input.body.request) && typeof input.body.project === "string") return input.body
  const native = isRecord(input.body) ? input.body : {}
  const tools = Array.isArray(native.tools) ? native.tools.map(cleanTool) : undefined
  const toolConfig = isRecord(native.toolConfig) ? native.toolConfig : {}
  const calling = isRecord(toolConfig.functionCallingConfig) ? toolConfig.functionCallingConfig : {}
  const trajectory = input.trajectory ?? randomUUID()
  const now = input.now ?? Date.now()
  const model = catalogID(input.model)
  const generationConfig = isRecord(native.generationConfig) ? { ...native.generationConfig } : undefined
  if (generationConfig && isRecord(generationConfig.thinkingConfig)) {
    generationConfig.thinkingConfig = { includeThoughts: true, ...generationConfig.thinkingConfig }
  }
  return {
    project: input.projectId,
    requestId: `agent/${safeSession(input.sessionID)}/${now}/${trajectory}/2`,
    model,
    userAgent: "antigravity",
    requestType: "agent",
    request: {
      ...native,
      ...(native.systemInstruction ? { systemInstruction: withSystemRole(native.systemInstruction) } : {}),
      ...(tools ? { tools } : {}),
      // Preserve NONE/ANY and named-tool restrictions, especially the runner's final-step tool ban.
      ...(tools && tools.length > 0 && (calling.mode === undefined || calling.mode === "AUTO")
        ? { toolConfig: { ...toolConfig, functionCallingConfig: { ...calling, mode: "VALIDATED" } } }
        : {}),
      ...(generationConfig ? { generationConfig } : {}),
      labels: {
        last_step_index: "1",
        ...(input.modelEnum ? { model_enum: input.modelEnum } : {}),
        request_id: `${trajectory}-0`,
        trajectory_id: trajectory,
        used_claude: "false",
        used_claude_conservative: "false",
        used_non_gemini_model: "false",
      },
      sessionId: sessionNumber(input.sessionID),
    },
  }
}

export function applyRequestHeaders(headers: Headers, accessToken: string) {
  headers.delete("x-goog-api-key")
  headers.set("Authorization", `Bearer ${accessToken}`)
  headers.set("User-Agent", GoogleAntigravityOAuth.userAgent())
  headers.set("Content-Type", "application/json")
}

export function unwrapDataLine(line: string) {
  if (!line.startsWith("data:")) return line
  const payload = line.slice(5).trim()
  if (!payload || payload === "[DONE]") return line
  const parsed = Option.getOrUndefined(decodeJson(payload))
  if (!isRecord(parsed) || !("response" in parsed)) return line
  return `data: ${JSON.stringify(parsed.response)}`
}

export function unwrapSSEText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("data:") ? unwrapDataLine(line) : line))
    .join("\n")
}

export function unwrapSSE() {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) controller.enqueue(encoder.encode(`${unwrapDataLine(line)}\n`))
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending.length > 0) controller.enqueue(encoder.encode(unwrapDataLine(pending)))
    },
  })
}

export type CloudCodeError = {
  code?: number
  status?: string
  message?: string
  reason?: string
  resetTime?: string
  retryDelay?: string
}

type QuotaWindow = {
  id: string
  remainingFraction: number
  resetTime?: string
}

/**
 * Read a Cloud Code error from the complete body. A 500-character prefix is not valid JSON
 * once the payload is longer than that, and slicing it drops the Google status and message.
 */
export function parseCloudCodeError(text: string): CloudCodeError | undefined {
  const trimmed = text.trim()
  if (!trimmed) return
  return cloudCodeError(trimmed) ?? cloudCodeError(payloadAfterPrefix(trimmed) ?? "")
}

function quotaWindows(summary: unknown): QuotaWindow[] {
  const root = isRecord(summary) ? summary : undefined
  if (!root || !Array.isArray(root.groups)) return []
  const windows: QuotaWindow[] = []
  const seen = new Set<string>()
  root.groups.forEach((rawGroup, index) => {
    const group = isRecord(rawGroup) ? rawGroup : undefined
    if (!group || !Array.isArray(group.buckets)) return
    const prefix = quotaGroupID(group, index)
    for (const rawBucket of group.buckets) {
      const bucket = isRecord(rawBucket) ? rawBucket : undefined
      if (!bucket) continue
      const fraction = finiteNumber(bucket.remainingFraction ?? bucket.remaining_fraction)
      if (fraction === undefined) continue
      const id = `${prefix}:${quotaWindowID(bucket)}`
      if (seen.has(id)) continue
      seen.add(id)
      const resetTime = textField(bucket.resetTime ?? bucket.reset_time)
      windows.push({ id, remainingFraction: fraction, ...(resetTime ? { resetTime } : {}) })
    }
  })
  return windows
}

export function explainCloudCodeError(input: {
  error: CloudCodeError
  summary?: unknown
  httpStatus: number
  modelID?: string
}) {
  if (!input.error.status && !input.error.message && !input.error.reason) return
  const windows = quotaWindows(input.summary)
  const fiveHour = fiveHourWindow(windows, input.modelID)
  const quota =
    input.error.reason?.toLowerCase() === "quota_exhausted" ||
    (input.error.status === "RESOURCE_EXHAUSTED" && fiveHour !== undefined && fiveHour.remainingFraction <= 0) ||
    (input.error.status === "RESOURCE_EXHAUSTED" && messageIsLongQuota(input.error.message))
  // Cloud Code answers some request content with an instant bare RESOURCE_EXHAUSTED while quota is untouched.
  // Retrying sends the same content again, so fail once instead of treating it as a throttle.
  const group = fiveHour ? `${fiveHour.id.split(":")[0]}:` : undefined
  const rejected =
    !quota &&
    !input.error.reason &&
    !input.error.retryDelay &&
    input.error.status === "RESOURCE_EXHAUSTED" &&
    fiveHour !== undefined &&
    fiveHour.remainingFraction >= 0.95 &&
    windows.every((window) => !window.id.startsWith(group ?? "") || window.remainingFraction > 0)
  const status =
    input.error.status && input.error.message
      ? `${input.error.status}: ${input.error.message}`
      : (input.error.status ?? input.error.message ?? "")
  const headline = rejected
    ? `${status} This is likely not quota: at least 95% of this model's quota is unused, so Google probably rejected this request's content. Not retrying; changing the prompt or switching models may help.`
    : status
  const readout = windows.map(
    (window) =>
      `${window.id} remainingFraction=${JSON.stringify(window.remainingFraction)}${window.resetTime ? ` resetTime=${window.resetTime}` : ""}`,
  )
  const fallbackReset = windows.length === 0 && input.error.resetTime ? [`resetTime=${input.error.resetTime}`] : []
  const message = [headline, ...readout, ...fallbackReset].filter((part) => part.length > 0).join(" ")
  const reason = quota ? "QUOTA_EXHAUSTED" : rejected ? "CONTENT_BLOCKED" : input.error.reason
  return {
    message,
    quota,
    rejected,
    body: JSON.stringify({
      error: {
        code: input.httpStatus,
        message,
        ...(input.error.status ? { status: input.error.status } : {}),
        ...(reason ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] } : {}),
      },
    }),
  }
}

function cloudCodeError(text: string): CloudCodeError | undefined {
  if (!text) return
  const parsed = Option.getOrUndefined(decodeJson(text))
  if (!isRecord(parsed)) return
  const error = isRecord(parsed.error) ? parsed.error : parsed
  const outerMessage = textField(error.message)
  const nested = outerMessage ? nestedGoogleError(outerMessage) : undefined
  const outerStatus = textField(error.status)
  const innerStatus = nested ? textField(nested.status) : undefined
  const status = innerStatus && (!outerStatus || outerStatus === "UNKNOWN") ? innerStatus : (outerStatus ?? innerStatus)
  const innerMessage = nested ? textField(nested.message) : undefined
  const message =
    outerMessage && innerMessage && outerMessage.includes("{") ? innerMessage : (outerMessage ?? innerMessage)
  const outerDetails = errorDetails(error)
  const details = outerDetails.reason ? outerDetails : nested ? errorDetails(nested) : outerDetails
  const code = finiteNumber(error.code ?? nested?.code)
  if (!status && !message && !details.reason) return
  return {
    ...(code === undefined ? {} : { code }),
    ...(status ? { status } : {}),
    ...(message ? { message } : {}),
    ...(details.reason ? { reason: details.reason } : {}),
    ...(details.resetTime ? { resetTime: details.resetTime } : {}),
    ...(details.retryDelay ? { retryDelay: details.retryDelay } : {}),
  }
}

function nestedGoogleError(message: string) {
  const start = message.indexOf("{")
  if (start < 0) return
  const parsed = Option.getOrUndefined(decodeJson(message.slice(start)))
  if (!isRecord(parsed)) return
  const error = isRecord(parsed.error) ? parsed.error : parsed
  if (!textField(error.status) && !textField(error.message) && !Array.isArray(error.details)) return
  return error
}

function errorDetails(error: Record<string, unknown> | undefined) {
  const details = error && Array.isArray(error.details) ? error.details : []
  return details.reduce<{ reason?: string; resetTime?: string; retryDelay?: string }>((acc, detail) => {
    if (!isRecord(detail)) return acc
    const metadata = isRecord(detail.metadata) ? detail.metadata : undefined
    return {
      reason: acc.reason ?? textField(detail.reason),
      resetTime:
        acc.resetTime ??
        textField(metadata?.quotaResetTimeStamp) ??
        textField(metadata?.quotaResetTimestamp) ??
        textField(metadata?.resetTime),
      retryDelay: acc.retryDelay ?? textField(detail.retryDelay),
    }
  }, {})
}

function payloadAfterPrefix(text: string) {
  const data = text.split(/\r?\n/).flatMap((line) => {
    const match = /^data:\s*(.*)$/.exec(line)
    return match?.[1] && match[1] !== "[DONE]" ? [match[1]] : []
  })
  const payload = [...data].reverse().find((line) => line.includes("{"))
  if (payload) return payload
  const start = text.indexOf("{")
  if (start < 0) return
  return text.slice(start)
}

function quotaGroupID(group: Record<string, unknown>, index: number) {
  const text = (
    textField(group.displayName) ??
    textField(group.display_name) ??
    textField(group.id) ??
    ""
  ).toLowerCase()
  if (text.includes("gemini")) return "gemini"
  if (text.includes("claude") || text.includes("gpt")) return "3p"
  return textField(group.id) ?? `group-${index}`
}

function quotaWindowID(bucket: Record<string, unknown>) {
  const raw = (textField(bucket.window) ?? "").toLowerCase()
  if (raw === "5h" || raw === "weekly") return raw
  return raw || textField(bucket.bucketId) || textField(bucket.bucket_id) || "limit"
}

function fiveHourWindow(windows: readonly QuotaWindow[], modelID: string | undefined) {
  const name = (modelID ?? "").toLowerCase()
  const preferred =
    name.includes("claude") || name.includes("gpt") ? "3p:5h" : name.includes("gemini") ? "gemini:5h" : undefined
  return windows.find((window) => window.id === preferred)
}

function messageIsLongQuota(message: string | undefined) {
  if (!message) return false
  if (/\b5h\b|5-hour|five[- ]hour/i.test(message)) return true
  const hours = /reset after\s+(\d+)h/i.exec(message)
  return hours !== null && Number(hours[1]) >= 1
}

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function textField(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function applyProvider(evt: ProviderEditor, active: boolean) {
  if (!active) return
  evt.update(googleProviderID, (provider) => {
    if (!provider.package) provider.package = "@opencode/ai/providers/google"
    provider.integrationID = GoogleAntigravityOAuth.integrationID
    if (!provider.name || provider.name === provider.id) provider.name = "Google"
  })
}

export function applyModels(evt: ModelEditor, active: boolean, disabled?: ReadonlySet<string>) {
  if (!active) return
  // Antigravity model ids are absent from the upstream catalog, so synthesized
  // entries receive the generic fallback limits (200k/32k), not real Gemini
  // limits. Only a real catalog entry's limit wins over the Flash numbers.
  const cataloged = new Set(evt.provider.get(googleProviderID)?.models.keys() ?? [])
  for (const model of shippedModels) {
    const denied = disabled?.has(model.id) === true || disabled?.has(catalogID(model.id)) === true
    evt.update(googleProviderID, model.id, (draft) => {
      draft.modelID = Model.ID.make(model.apiID ?? model.id)
      draft.name = model.name
      draft.cost = []
      draft.enabled = !denied
      draft.status = "active"
      if (!cataloged.has(model.id)) draft.limit = { ...FLASH_LIMIT }
      draft.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
      if (!draft.package) draft.package = "@opencode/ai/providers/google"
    })
  }
  const item = evt.provider.get(googleProviderID)
  if (item) {
    for (const id of item.models.keys()) {
      if (shippedIDs.has(id) && !disabled?.has(id) && !disabled?.has(catalogID(id))) continue
      evt.update(googleProviderID, id, (draft) => {
        draft.enabled = false
      })
    }
  }
}
