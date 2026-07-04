import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpMethod } from "effect/unstable/http"
import { ToolError, toolError } from "../../tool-error.js"
import { isRecord, maxErrorBodyChars, own } from "./spec.js"
import type { AppliedAuth, Credential, Plan, SecurityScheme } from "./types.js"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export const invoke = (plan: Plan, input: unknown): Effect.Effect<unknown, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const value = isRecord(input) ? input : {}

    // Local validation before auth resolution, which may refresh tokens.
    const url = buildUrl(plan, value)
    if (url instanceof ToolError) return yield* Effect.fail(url)
    for (const field of plan.fields) {
      if (!field.required || field.location === "path") continue
      const item = own(value, field.inputName)
      if (item === undefined || (field.location !== "body" && item === null)) {
        const label = field.location === "body" ? "body field" : `${field.location} parameter`
        return yield* Effect.fail(toolError(`Missing required ${label} '${field.inputName}'.`))
      }
    }

    const auth = yield* resolveAuth(plan)

    let request = HttpClientRequest.make(plan.operation.method as HttpMethod.HttpMethod)(url)
    for (const field of plan.fields) {
      if (field.location !== "query") continue
      const item = own(value, field.inputName)
      if (item === undefined || item === null) continue
      const rendered = Array.isArray(item) ? item.map(renderPrimitive) : [renderPrimitive(item)]
      for (const one of rendered) {
        request = HttpClientRequest.appendUrlParam(request, field.name, one)
      }
    }
    for (const [name, item] of Object.entries(auth.query)) {
      request = HttpClientRequest.setUrlParam(request, name, item)
    }
    // Host headers first, then declared header params, then auth - auth must win.
    request = HttpClientRequest.setHeaders(request, plan.headers)
    for (const field of plan.fields) {
      if (field.location !== "header") continue
      const item = own(value, field.inputName)
      if (item === undefined || item === null) continue
      request = HttpClientRequest.setHeader(request, field.name, renderPrimitive(item))
    }
    const cookiePairs = Object.entries(auth.cookies).map(([name, item]) => `${name}=${item}`)
    if (cookiePairs.length > 0) request = HttpClientRequest.setHeader(request, "cookie", cookiePairs.join("; "))
    request = HttpClientRequest.setHeaders(request, auth.headers)
    if (plan.body?.mode === "value") {
      const field = plan.fields.find((field) => field.location === "body")
      const body = field === undefined ? undefined : own(value, field.inputName)
      if (body !== undefined) request = HttpClientRequest.bodyJsonUnsafe(request, body)
    }
    if (plan.body?.mode === "object") {
      const entries = plan.fields.flatMap((field) => {
        if (field.location !== "body") return []
        const item = own(value, field.inputName)
        return item === undefined ? [] : [[field.name, item] as const]
      })
      if (plan.body.required || entries.length > 0) {
        request = HttpClientRequest.bodyJsonUnsafe(request, Object.fromEntries(entries))
      }
    }

    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.catch((cause) =>
          Effect.fail(toolError(`${plan.operation.method} ${plan.operation.path} failed: transport error`, cause)),
        ),
      )
    // Best effort: an unreadable body degrades to the status-only error/null result.
    const text = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
    const parsed = text === "" ? null : Option.getOrElse(decodeJson(text), () => text)
    if (response.status < 200 || response.status >= 300) {
      const rendered = typeof parsed === "string" ? parsed : (JSON.stringify(parsed) ?? "")
      const summary =
        rendered === "" || rendered === "null"
          ? "no response body"
          : rendered.length > maxErrorBodyChars
            ? `${rendered.slice(0, maxErrorBodyChars)}...`
            : rendered
      return yield* Effect.fail(
        toolError(`${plan.operation.method} ${plan.operation.path} failed with HTTP ${response.status}: ${summary}`),
      )
    }
    return parsed
  })

const resolveAuth = (plan: Plan): Effect.Effect<AppliedAuth, unknown> =>
  Effect.gen(function* () {
    const none: AppliedAuth = { headers: {}, query: {}, cookies: {} }
    if (plan.security.length === 0) return none

    const unavailable: Array<string> = []
    alternatives: for (const requirement of plan.security) {
      const names = Object.keys(requirement)
      if (names.length === 0) return none
      const credentials: Array<readonly [SecurityScheme, Credential]> = []
      for (const name of names) {
        const scheme = own(plan.schemes, name)
        if (scheme === undefined || plan.auth === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        const credential = yield* plan.auth.resolve({
          schemeName: name,
          scheme,
          scopes: requirement[name] ?? [],
          operation: plan.operation,
        })
        if (credential === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        credentials.push([scheme, credential])
      }
      const applied = applyCredentials(credentials)
      return applied instanceof ToolError ? yield* Effect.fail(applied) : applied
    }

    return yield* Effect.fail(
      toolError(
        `${plan.operation.method} ${plan.operation.path} requires authentication; no credential available for: ${[...new Set(unavailable)].join(", ")}.`,
      ),
    )
  })

const applyCredentials = (
  credentials: ReadonlyArray<readonly [SecurityScheme, Credential]>,
): AppliedAuth | ToolError => {
  const headers: Record<string, string> = {}
  const query: Record<string, string> = {}
  const cookies: Record<string, string> = {}
  for (const [scheme, credential] of credentials) {
    if (credential.type === "bearer") {
      headers["authorization"] = `Bearer ${credential.token}`
      continue
    }
    if (credential.type === "basic") {
      // Buffer instead of btoa: btoa throws on non-Latin-1 credentials.
      headers["authorization"] =
        `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`
      continue
    }
    if (credential.type === "header") {
      headers[credential.name.toLowerCase()] = credential.value
      continue
    }
    // apiKey: the carrier comes from the scheme declaration.
    const name = scheme.parameterName
    if (scheme.type !== "apiKey" || name === undefined || scheme.in === undefined) {
      return toolError(
        `Security scheme '${scheme.name}' is not an apiKey scheme; resolve a bearer, basic, or header credential for it.`,
      )
    }
    if (scheme.in === "header") headers[name.toLowerCase()] = credential.value
    if (scheme.in === "query") query[name] = credential.value
    if (scheme.in === "cookie") cookies[name] = credential.value
  }
  return { headers, query, cookies }
}

const renderPrimitive = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)

const buildUrl = (plan: Plan, input: Readonly<Record<string, unknown>>): string | ToolError => {
  let url = plan.url
  for (const field of plan.fields) {
    if (field.location !== "path") continue
    const item = own(input, field.inputName)
    if (item === undefined || item === null) {
      return toolError(`Missing required path parameter '${field.inputName}'.`)
    }
    const rendered = encodeURIComponent(renderPrimitive(item))
    // '.'/'..' survive encoding and URL normalization collapses them, letting a
    // model-supplied value retarget the request to a different endpoint.
    if (rendered === "" || rendered === "." || rendered === "..") {
      return toolError(`Invalid path parameter '${field.inputName}'.`)
    }
    url = url.replaceAll(`{${field.name}}`, rendered)
  }
  const unresolved = url.match(/\{[^{}]+\}/)
  if (unresolved !== null) return toolError(`Unresolved path parameter ${unresolved[0]}.`)
  return url
}
