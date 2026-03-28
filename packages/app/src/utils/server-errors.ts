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

type OpenclawGuidance = {
  kind: "file_unsupported" | "gateway_unavailable" | "gateway_auth"
  message: string
}

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  const openclaw = parseOpenclawError(error, translate)
  if (openclaw) return openclaw.message
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

export function parseOpenclawError(error: unknown, translate?: Translator): OpenclawGuidance | undefined {
  const message =
    nestedMessage(error) ?? (error instanceof Error ? error.message : typeof error === "string" ? error : "")
  if (!message) return
  const lower = message.toLowerCase()

  if (lower.includes("does not expose a project filesystem yet")) {
    return {
      kind: "file_unsupported",
      message: [
        tr(
          translate,
          "error.openclaw.fileUnsupported",
          "OpenClaw 目前还不提供项目文件树。你可以继续在 OpenClaw 中对话，但文件浏览/打开请切回普通项目。",
        ),
        tr(
          translate,
          "error.openclaw.fileUnsupported.hint",
          "如果你想让 OpenClaw 管理某个项目，后续更适合做成项目内悬浮管家，而不是直接复用项目文件树。",
        ),
      ].join("\n"),
    }
  }

  if (
    lower.includes("gateway not connected") ||
    lower.includes("failed to connect to openclaw gateway") ||
    lower.includes("gateway connect timeout") ||
    lower.includes("gateway connection closed") ||
    lower.includes("openclaw gateway session listing failed") ||
    lower.includes("openclaw gateway history loading")
  ) {
    return {
      kind: "gateway_unavailable",
      message: [
        tr(
          translate,
          "error.openclaw.gatewayUnavailable",
          "OpenClaw gateway 当前不可用，导致会话列表或历史消息无法加载。",
        ),
        tr(
          translate,
          "error.openclaw.gatewayUnavailable.hint",
          "请检查桌面设置里的 Gateway URL 是否正确，然后确认 gateway 进程仍在线；如果刚重启电脑，通常需要重新启动或重新连接 gateway。",
        ),
        message,
      ].join("\n"),
    }
  }

  if (
    lower.includes("accepted") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("token")
  ) {
    return {
      kind: "gateway_auth",
      message: [
        tr(translate, "error.openclaw.gatewayAuth", "OpenClaw gateway 鉴权可能失败了。"),
        tr(
          translate,
          "error.openclaw.gatewayAuth.hint",
          "请检查桌面设置中的 Gateway Token 是否仍然有效，并确认当前账号/设备有权限连接该 gateway。",
        ),
        message,
      ].join("\n"),
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
