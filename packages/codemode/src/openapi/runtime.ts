import { Effect, Option, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, type HttpMethod } from "effect/unstable/http"
import { ToolError, toolError } from "../tool-error.js"
import { isRecord, own } from "./spec.js"
import type { AppliedAuth, Credential, Plan, SecurityScheme } from "./types.js"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const maxErrorBodyChars = 1_024
const maxResponseBodyBytes = 50 * 1024 * 1024

export const invoke = (plan: Plan, input: unknown): Effect.Effect<unknown, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const value = isRecord(input) ? input : {}

    let request = yield* buildRequest(plan, value)

    const auth = yield* resolveAuth(plan)
    for (const [name, item] of Object.entries(auth.query)) {
      request = HttpClientRequest.setUrlParam(request, name, item)
    }
    request = HttpClientRequest.setHeaders(request, auth.headers)

    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.catch((cause) =>
          Effect.fail(toolError(`${plan.operation.method} ${plan.operation.path} failed: transport error`, cause)),
        ),
      )
    const text = yield* readResponseBody(response, plan)
    const mediaType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()
    const json = mediaType === "application/json" || mediaType?.endsWith("+json") === true
    const decoded = text === "" ? Option.some(null) : json ? decodeJson(text) : Option.none()
    const parsed = json ? Option.getOrElse(decoded, () => text) : text === "" ? null : text
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
    if (json && Option.isNone(decoded)) {
      return yield* Effect.fail(toolError(`${plan.operation.method} ${plan.operation.path} returned malformed JSON.`))
    }
    return parsed
  })

const buildRequest = (
  plan: Plan,
  input: Readonly<Record<string, unknown>>,
): Effect.Effect<HttpClientRequest.HttpClientRequest, ToolError> =>
  Effect.gen(function* () {
    // Validate model input before auth resolution can refresh credentials.
    const url = buildUrl(plan, input)
    if (url instanceof ToolError) return yield* Effect.fail(url)
    const missing = plan.fields.find(
      (field) => field.required && field.location !== "path" && own(input, field.inputName) === undefined,
    )
    if (missing !== undefined) {
      const label = missing.location === "body" ? "body field" : `${missing.location} parameter`
      return yield* Effect.fail(toolError(`Missing required ${label} '${missing.inputName}'.`))
    }

    let request = HttpClientRequest.make(plan.operation.method as HttpMethod.HttpMethod)(url)
    for (const field of plan.fields) {
      if (field.location !== "query") continue
      const item = own(input, field.inputName)
      if (item === undefined) continue
      const serialized = serializeQuery(request, field, item)
      if (serialized instanceof ToolError) return yield* Effect.fail(serialized)
      request = serialized
    }

    request = HttpClientRequest.setHeaders(request, plan.headers)
    for (const field of plan.fields) {
      if (field.location !== "header") continue
      const item = own(input, field.inputName)
      if (item === undefined) continue
      const serialized = serializeSimple(field, item, String)
      if (serialized instanceof ToolError) return yield* Effect.fail(serialized)
      request = HttpClientRequest.setHeader(request, field.name, serialized)
    }

    const setBody = (value: unknown, mediaType: string) =>
      HttpClientRequest.bodyJson(request, value).pipe(
        Effect.map((next) => HttpClientRequest.setHeader(next, "content-type", mediaType)),
        Effect.mapError((cause) =>
          toolError(`Invalid JSON body for ${plan.operation.method} ${plan.operation.path}.`, cause),
        ),
      )
    if (plan.body?.mode === "value") {
      const field = plan.fields.find((field) => field.location === "body")
      const body = field === undefined ? undefined : own(input, field.inputName)
      if (body !== undefined) request = yield* setBody(body, plan.body.mediaType)
    }
    if (plan.body?.mode === "object") {
      const entries = plan.fields.flatMap((field) => {
        if (field.location !== "body") return []
        const item = own(input, field.inputName)
        return item === undefined ? [] : [[field.name, item] as const]
      })
      if (plan.body.required || entries.length > 0) {
        request = yield* setBody(Object.fromEntries(entries), plan.body.mediaType)
      }
    }
    return request
  })

const resolveAuth = (plan: Plan): Effect.Effect<AppliedAuth, unknown> =>
  Effect.gen(function* () {
    const none: AppliedAuth = { headers: {}, query: {} }
    if (plan.security.length === 0) return none

    const unavailable: Array<string> = []
    alternatives: for (const requirement of plan.security) {
      const names = Object.keys(requirement)
      if (names.length === 0) return none
      const credentials: Array<readonly [string, SecurityScheme, Credential]> = []
      for (const name of names) {
        const scheme = own(plan.schemes, name)
        if (scheme === undefined || plan.auth === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        const credential = yield* plan.auth.resolve({
          name,
          definition: scheme,
          scopes: requirement[name] ?? [],
          operation: plan.operation,
        })
        if (credential === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        credentials.push([name, scheme, credential])
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
  credentials: ReadonlyArray<readonly [string, SecurityScheme, Credential]>,
): AppliedAuth | ToolError => {
  const headers = new Map<string, string>()
  const query = new Map<string, string>()
  const add = (carrier: "header" | "query", name: string, value: string): ToolError | undefined => {
    const target = carrier === "header" ? headers : query
    if (target.has(name)) return toolError(`Authentication resolves multiple credentials for ${carrier} '${name}'.`)
    target.set(name, value)
  }
  for (const [name, definition, credential] of credentials) {
    if (credential.type === "bearer") {
      const duplicate = add("header", "authorization", `Bearer ${credential.token}`)
      if (duplicate !== undefined) return duplicate
      continue
    }
    if (credential.type === "basic") {
      // Basic auth credentials are UTF-8; btoa rejects non-Latin-1 input.
      const duplicate = add(
        "header",
        "authorization",
        `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`,
      )
      if (duplicate !== undefined) return duplicate
      continue
    }
    if (credential.type === "header") {
      const duplicate = add("header", credential.name.toLowerCase(), credential.value)
      if (duplicate !== undefined) return duplicate
      continue
    }
    if (definition.type !== "apiKey") {
      return toolError(
        `Security scheme '${name}' is not an apiKey scheme; resolve a bearer, basic, or header credential for it.`,
      )
    }
    if (definition.in === "cookie") return toolError(`Cookie authentication '${name}' is not supported.`)
    const parameter = definition.in === "header" ? definition.name.toLowerCase() : definition.name
    const duplicate = add(definition.in, parameter, credential.value)
    if (duplicate !== undefined) return duplicate
  }
  return { headers: Object.fromEntries(headers), query: Object.fromEntries(query) }
}

const buildUrl = (plan: Plan, input: Readonly<Record<string, unknown>>): string | ToolError => {
  let url = plan.url
  for (const field of plan.fields) {
    if (field.location !== "path") continue
    const item = own(input, field.inputName)
    if (item === undefined) {
      return toolError(`Missing required path parameter '${field.inputName}'.`)
    }
    const fieldValue = serializeSimple(field, item, (value) =>
      encodeURIComponent(value).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    if (fieldValue instanceof ToolError) return fieldValue
    // URL normalization collapses encoded `.` and `..`, which could retarget the request.
    if (fieldValue === "" || fieldValue === "." || fieldValue === "..") {
      return toolError(`Invalid path parameter '${field.inputName}'.`)
    }
    url = url.replaceAll(`{${field.name}}`, fieldValue)
  }
  const unresolved = url.match(/\{[^{}]+\}/)
  if (unresolved !== null) return toolError(`Unresolved path parameter ${unresolved[0]}.`)
  return url
}

const serializeSimple = (
  field: Plan["fields"][number],
  value: unknown,
  encode: (value: string) => string,
): string | ToolError => {
  const scalar = (item: unknown): string | ToolError =>
    item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean"
      ? toolError(`Parameter '${field.inputName}' contains an unsupported nested value.`)
      : encode(String(item))
  if (Array.isArray(value)) {
    const items = value.map(scalar)
    const invalid = items.find((item): item is ToolError => item instanceof ToolError)
    return invalid ?? items.join(",")
  }
  if (!isRecord(value)) return scalar(value)
  const entries = Object.entries(value).flatMap<string | ToolError>(([name, item]) => {
    const rendered = scalar(item)
    if (rendered instanceof ToolError) return [rendered]
    return field.explode ? [`${encode(name)}=${rendered}`] : [encode(name), rendered]
  })
  const invalid = entries.find((item): item is ToolError => item instanceof ToolError)
  return invalid ?? entries.join(",")
}

const serializeQuery = (
  request: HttpClientRequest.HttpClientRequest,
  field: Plan["fields"][number],
  value: unknown,
): HttpClientRequest.HttpClientRequest | ToolError => {
  if (field.style === "deepObject") {
    if (!isRecord(value)) return toolError(`Deep-object parameter '${field.inputName}' must be an object.`)
    return Object.entries(value).reduce<HttpClientRequest.HttpClientRequest | ToolError>((current, [name, item]) => {
      if (current instanceof ToolError) return current
      if (item === undefined || (item !== null && typeof item === "object")) {
        return toolError(`Deep-object parameter '${field.inputName}' contains an unsupported nested value.`)
      }
      return HttpClientRequest.appendUrlParam(current, `${field.name}[${name}]`, String(item))
    }, request)
  }
  if (Array.isArray(value)) {
    const rendered = serializeSimple(field, value, String)
    if (rendered instanceof ToolError) return rendered
    if (!field.explode) return HttpClientRequest.appendUrlParam(request, field.name, rendered)
    if (value.some((item) => item === undefined || (item !== null && typeof item === "object"))) {
      return toolError(`Query parameter '${field.inputName}' contains an unsupported nested value.`)
    }
    return value.reduce((current, item) => HttpClientRequest.appendUrlParam(current, field.name, String(item)), request)
  }
  if (isRecord(value) && field.explode) {
    return Object.entries(value).reduce<HttpClientRequest.HttpClientRequest | ToolError>((current, [name, item]) => {
      if (current instanceof ToolError) return current
      if (item === undefined || (item !== null && typeof item === "object")) {
        return toolError(`Query parameter '${field.inputName}' contains an unsupported nested value.`)
      }
      return HttpClientRequest.appendUrlParam(current, name, String(item))
    }, request)
  }
  const rendered = serializeSimple(field, value, String)
  return rendered instanceof ToolError ? rendered : HttpClientRequest.appendUrlParam(request, field.name, rendered)
}

const readResponseBody = (
  response: HttpClientResponse.HttpClientResponse,
  plan: Plan,
): Effect.Effect<string, ToolError> =>
  Effect.gen(function* () {
    const contentLength = response.headers["content-length"]
    const parsedSize = contentLength === undefined ? undefined : Number.parseInt(contentLength, 10)
    const declaredSize =
      parsedSize !== undefined && Number.isSafeInteger(parsedSize) && parsedSize >= 0 ? parsedSize : undefined
    if (declaredSize !== undefined && declaredSize > maxResponseBodyBytes) {
      return yield* Effect.fail(toolError(`${plan.operation.method} ${plan.operation.path} response exceeds 50 MiB.`))
    }
    let body = Buffer.allocUnsafe(Math.min(maxResponseBodyBytes, declaredSize ?? 64 * 1024))
    let size = 0
    yield* Stream.runForEach(response.stream, (chunk) => {
      if (size + chunk.byteLength > maxResponseBodyBytes) {
        return Effect.fail(toolError(`${plan.operation.method} ${plan.operation.path} response exceeds 50 MiB.`))
      }
      if (size + chunk.byteLength > body.byteLength) {
        const grown = Buffer.allocUnsafe(
          Math.min(maxResponseBodyBytes, Math.max(size + chunk.byteLength, body.byteLength * 2)),
        )
        body.copy(grown, 0, 0, size)
        body = grown
      }
      body.set(chunk, size)
      size += chunk.byteLength
      return Effect.void
    }).pipe(
      Effect.catch((cause) => {
        if (cause instanceof ToolError) return Effect.fail(cause)
        if (cause.reason._tag === "EmptyBodyError") return Effect.void
        return Effect.fail(
          toolError(`${plan.operation.method} ${plan.operation.path} failed while reading the response body.`, cause),
        )
      }),
    )
    return new TextDecoder().decode(body.subarray(0, size))
  })
