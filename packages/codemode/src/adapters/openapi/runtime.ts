import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpMethod } from "effect/unstable/http"
import { ToolError, toolError } from "../../tool-error.js"
import { isRecord, maxErrorBodyChars, own } from "./spec.js"
import type { AppliedAuth, Credential, Plan, SecurityScheme } from "./types.js"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export const invoke = (plan: Plan, input: unknown): Effect.Effect<unknown, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const value = isRecord(input) ? input : {}
    const query = isRecord(value.query) ? value.query : {}
    const headers = isRecord(value.headers) ? value.headers : {}

    // Local validation before auth resolution, which may refresh tokens.
    const url = buildUrl(plan, isRecord(value.path) ? value.path : {})
    if (url instanceof ToolError) return yield* Effect.fail(url)
    if (plan.body?.required === true && value.body === undefined) {
      return yield* Effect.fail(toolError("Missing required request body."))
    }
    for (const parameter of plan.parameters) {
      if (!parameter.required || parameter.location === "path") continue
      const source = parameter.location === "query" ? query : headers
      const item = own(source, parameter.name)
      if (item === undefined || item === null) {
        return yield* Effect.fail(toolError(`Missing required ${parameter.location} parameter '${parameter.name}'.`))
      }
    }

    const auth = yield* resolveAuth(plan)

    let request = HttpClientRequest.make(plan.operation.method as HttpMethod.HttpMethod)(url)
    for (const parameter of plan.parameters) {
      if (parameter.location !== "query") continue
      const item = own(query, parameter.name)
      if (item === undefined || item === null) continue
      const rendered = Array.isArray(item) ? item.map(renderPrimitive) : [renderPrimitive(item)]
      for (const one of rendered) {
        request = HttpClientRequest.appendUrlParam(request, parameter.name, one)
      }
    }
    for (const [name, item] of Object.entries(auth.query)) {
      request = HttpClientRequest.setUrlParam(request, name, item)
    }
    // Host headers first, then declared header params, then auth - auth must win.
    request = HttpClientRequest.setHeaders(request, plan.headers)
    for (const parameter of plan.parameters) {
      if (parameter.location !== "header") continue
      const item = own(headers, parameter.name)
      if (item === undefined || item === null) continue
      request = HttpClientRequest.setHeader(request, parameter.name, renderPrimitive(item))
    }
    const cookiePairs = Object.entries(auth.cookies).map(([name, item]) => `${name}=${item}`)
    if (cookiePairs.length > 0) request = HttpClientRequest.setHeader(request, "cookie", cookiePairs.join("; "))
    request = HttpClientRequest.setHeaders(request, auth.headers)
    if (plan.body !== undefined && value.body !== undefined) {
      request = HttpClientRequest.bodyJsonUnsafe(request, value.body)
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
      return yield* Effect.fail(
        toolError(
          `${plan.operation.method} ${plan.operation.path} failed with HTTP ${response.status}: ${summarizeBody(parsed)}`,
        ),
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

const applyCredentials = (credentials: ReadonlyArray<readonly [SecurityScheme, Credential]>): AppliedAuth | ToolError => {
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

const summarizeBody = (body: unknown): string => {
  const rendered = typeof body === "string" ? body : (JSON.stringify(body) ?? "")
  if (rendered === "" || rendered === "null") return "no response body"
  return rendered.length > maxErrorBodyChars ? `${rendered.slice(0, maxErrorBodyChars)}...` : rendered
}

const renderPrimitive = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)

const buildUrl = (plan: Plan, path: Readonly<Record<string, unknown>>): string | ToolError => {
  let url = plan.url
  for (const parameter of plan.parameters) {
    if (parameter.location !== "path") continue
    const item = own(path, parameter.name)
    if (item === undefined || item === null) {
      return toolError(`Missing required path parameter '${parameter.name}'.`)
    }
    const rendered = encodeURIComponent(renderPrimitive(item))
    // '.'/'..' survive encoding and URL normalization collapses them, letting a
    // model-supplied value retarget the request to a different endpoint.
    if (rendered === "" || rendered === "." || rendered === "..") {
      return toolError(`Invalid path parameter '${parameter.name}'.`)
    }
    url = url.replaceAll(`{${parameter.name}}`, rendered)
  }
  const unresolved = url.match(/\{[^{}]+\}/)
  if (unresolved !== null) return toolError(`Unresolved path parameter ${unresolved[0]}.`)
  return url
}
