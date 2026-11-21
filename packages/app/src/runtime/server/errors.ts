import { Predicate } from "effect"

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

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)

  if (!out || out === key) return text

  return out
}

export function formatServerError(cause: unknown, translate?: Translator, fallback?: string) {
  const unwrapped = unwrapNamedError(cause)

  if (isConfigInvalidErrorLike(unwrapped)) return parseReadableConfigInvalidError(unwrapped, translate)

  if (isProviderModelNotFoundErrorLike(unwrapped)) return parseReadableProviderModelNotFoundError(unwrapped, translate)

  if (
    Predicate.isObjectOrArray(unwrapped) &&
    Predicate.hasProperty(unwrapped, "message") &&
    Predicate.isString(unwrapped.message) &&
    unwrapped.message
  )
    return unwrapped.message

  if (cause instanceof Error && cause.message) return cause.message

  if (Predicate.isString(cause) && cause) return cause

  if (fallback) return fallback

  return tr(translate, "error.chain.unknown", "Unknown error")
}

function unwrapNamedError(cause: unknown) {
  if (!(cause instanceof Error) || !Predicate.isObjectOrArray(cause.cause)) return cause

  if (Predicate.hasProperty(cause.cause, "body")) return cause.cause.body

  return cause.cause
}

export function isSessionNotFoundError(cause: unknown, sessionID: string) {
  const unwrapped = unwrapNamedError(cause)

  return (
    Predicate.isObjectOrArray(unwrapped) &&
    Predicate.isTagged(unwrapped, "SessionNotFoundError") &&
    Predicate.hasProperty(unwrapped, "sessionID") &&
    unwrapped.sessionID === sessionID
  )
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  return (
    Predicate.isObjectOrArray(error) &&
    Predicate.hasProperty(error, "name") &&
    error.name === "ConfigInvalidError" &&
    Predicate.hasProperty(error, "data") &&
    Predicate.isObjectOrArray(error.data)
  )
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  return (
    Predicate.isObjectOrArray(error) &&
    Predicate.hasProperty(error, "name") &&
    error.name === "ProviderModelNotFoundError" &&
    Predicate.hasProperty(error, "data") &&
    Predicate.isObjectOrArray(error.data)
  )
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
