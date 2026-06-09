import { Duration, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const IFLOW_DEFAULT_BASE_URL = "https://platform.iflow.cn"

export function iflowBaseURL() {
  return (process.env.IFLOW_BASE_URL || IFLOW_DEFAULT_BASE_URL).replace(/\/+$/, "")
}

export function requireIflowAPIKey(message: string) {
  const key = process.env.IFLOW_API_KEY
  if (!key) throw new Error(message)
  return key
}

export function iflowURL(path: string) {
  return `${iflowBaseURL()}${path.startsWith("/") ? path : `/${path}`}`
}

export const postJson = (
  http: HttpClient.HttpClient,
  path: string,
  body: unknown,
  missingKeyMessage: string,
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(iflowURL(path)).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${requireIflowAPIKey(missingKeyMessage)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      HttpClientRequest.bodyJson(body),
    )

    const response = yield* http
      .execute(request)
      .pipe(Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("iFlow request timed out")) }))

    const text = yield* response.text

    if (response.status === 401 || response.status === 403) {
      throw new Error("iFlow request was not authorized. Check IFLOW_API_KEY.")
    }
    if (response.status === 429) {
      throw new Error("iFlow rate limit exceeded. Please try again later.")
    }
    if (response.status >= 500) {
      throw new Error(`iFlow service error (${response.status}). Please try again later.`)
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`iFlow request failed with status ${response.status}.`)
    }

    const data = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () => new Error("iFlow returned invalid JSON."),
    })
    const object = objectValue(data)
    if (!object) throw new Error("iFlow returned invalid JSON.")
    const businessError = getBusinessError(object)
    if (businessError) throw new Error(businessError)
    return object
  })

function getBusinessError(data: Record<string, unknown>) {
  if (data.success === false) return `iFlow request failed${formatMessage(data)}.`
  const code = stringValue(data.code) ?? stringValue(data.status)
  if (code && !["0", "200", "success", "ok"].includes(code.toLowerCase())) {
    return `iFlow request failed${formatMessage(data)}.`
  }
  return undefined
}

function formatMessage(data: Record<string, unknown>) {
  const message = stringValue(data.message) ?? stringValue(data.msg) ?? stringValue(data.error)
  return message ? `: ${message}` : ""
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined
}
