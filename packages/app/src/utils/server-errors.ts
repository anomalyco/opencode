import { extraAgents, type ExtraAgentErrorMatcher } from "@/pages/layout/extra-agents"

export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export type ProviderModelNotFoundError = {
  name: "ProviderModelNotFoundError"
  data: {
    providerID: string
    modelID: string
    suggestions?: string[]
  }
}

type Translator = (key: string, vars?: Record<string, string | number>) => string

export type ExtraAgentErrorGuidance = {
  agentId: string
  kind: string
  message: string
}

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  const extraAgent = parseExtraAgentError(error, translate)
  if (extraAgent) return extraAgent.message
  if (isConfigInvalidErrorLike(error)) return parseReadableConfigInvalidError(error, translate)
  if (isProviderModelNotFoundErrorLike(error)) return parseReadableProviderModelNotFoundError(error, translate)
  const message = nestedMessage(error)
  if (message) return message
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

export function permissionNotice(error: unknown, translate?: Translator, kind: "file" | "session" = "file") {
  const message =
    nestedMessage(error) ?? (error instanceof Error ? error.message : typeof error === "string" ? error : "")
  if (!message) return
  const lower = message.toLowerCase()
  const denied =
    lower.includes("eperm") ||
    lower.includes("eacces") ||
    lower.includes("operation not permitted") ||
    lower.includes("permission denied") ||
    lower.includes("access denied")
  if (!denied) return
  if (kind === "session") {
    return tr(
      translate,
      "error.permission.sessionProtected",
      "This directory is protected by the system and its sessions cannot be loaded.",
    )
  }
  return tr(
    translate,
    "error.permission.fileProtected",
    "This directory is protected by the system and cannot be read.",
  )
}

export function parseExtraAgentError(error: unknown, translate?: Translator): ExtraAgentErrorGuidance | undefined {
  const message =
    nestedMessage(error) ?? (error instanceof Error ? error.message : typeof error === "string" ? error : "")
  if (!message) return
  const lower = message.toLowerCase()

  for (const agent of extraAgents) {
    const matchers = agent.capabilities?.errorMatchers
    if (!matchers) continue
    const hit = findMatcher(matchers, lower)
    if (!hit) continue
    const lines = hit.lines.map(({ key, fallback }) => tr(translate, key, fallback))
    if (hit.appendOriginal) lines.push(message)
    return {
      agentId: agent.id,
      kind: hit.kind,
      message: lines.join("\n"),
    }
  }
}

function findMatcher(
  matchers: ReadonlyArray<ExtraAgentErrorMatcher>,
  lower: string,
): ExtraAgentErrorMatcher | undefined {
  for (const matcher of matchers) {
    try {
      if (matcher.match(lower)) return matcher
    } catch {
      continue
    }
  }
}

function nestedMessage(error: unknown, seen = new Set<unknown>()): string | undefined {
  if (!error || typeof error !== "object") return
  if (seen.has(error)) return
  seen.add(error)

  const obj = error as Record<string, unknown>
  const direct = [obj.message, obj.detail, obj.error_description].find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
  if (direct) return direct

  const data = obj.data
  if (data && typeof data === "object") {
    const inner = data as Record<string, unknown>
    const hit = [inner.message, inner.detail, inner.error_description].find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    )
    if (hit) return hit
  }

  const errorField = obj.error
  if (typeof errorField === "string" && errorField.trim()) return errorField
  if (errorField && typeof errorField === "object") {
    const hit = nestedMessage(errorField, seen)
    if (hit) return hit
  }

  const body = obj.body
  if (body && typeof body === "object") {
    const hit = nestedMessage(body, seen)
    if (hit) return hit
  }

  const cause = obj.cause
  if (cause instanceof Error && cause.message) return cause.message
  if (cause && typeof cause === "object") return nestedMessage(cause, seen)

  return
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ProviderModelNotFoundError" && typeof o.data === "object" && o.data !== null
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()
      if (!issue.path.length) return msg
      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)
  const msg = issues.length ? issues.join("\n") : detail
  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })
  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (opencode.json) provider/model names")
  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")
    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }
  return [body, tail].join("\n")
}
