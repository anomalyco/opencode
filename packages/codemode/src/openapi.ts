import { Effect } from "effect"
import { HttpClient, HttpClientRequest, type HttpMethod } from "effect/unstable/http"
import { toolError } from "./tool-error.js"
import { Tool, type Definition, type JsonSchema } from "./tool.js"

/** A parsed OpenAPI 3.x document. */
export type Document = Record<string, unknown>

/** The operation identity handed to auth resolution and errors. */
export type Operation = {
  readonly id: string
  readonly method: string
  readonly path: string
  readonly summary: string | undefined
  readonly description: string | undefined
}

/** A resolved OpenAPI security scheme from `components.securitySchemes`. */
export type SecurityScheme = {
  readonly name: string
  readonly type: "apiKey" | "http" | "oauth2" | "openIdConnect"
  /** apiKey carrier declared by the spec. */
  readonly in: "header" | "query" | "cookie" | undefined
  /** apiKey parameter name declared by the spec. */
  readonly parameterName: string | undefined
  /** `http` scheme (`bearer`, `basic`, ...). */
  readonly scheme: string | undefined
}

/**
 * Credential material returned by a host auth resolver. The carrier for `apiKey`
 * comes from the scheme definition, not the credential, so a host cannot place a
 * key on the wrong carrier. `header` is the escape hatch for nonstandard schemes.
 */
export type Credential =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "apiKey"; readonly value: string }
  | { readonly type: "header"; readonly name: string; readonly value: string }

/**
 * Resolves credential material for one named security scheme at call time.
 * `undefined` means "this scheme is unavailable, try the next OR alternative";
 * a failure aborts the tool call (an expired refresh token must not silently
 * fall through to an unauthenticated alternative).
 */
export type AuthResolver = (context: {
  readonly schemeName: string
  readonly scheme: SecurityScheme
  readonly scopes: ReadonlyArray<string>
  readonly operation: Operation
}) => Effect.Effect<Credential | undefined, unknown>

export type Options = {
  /** Parsed OpenAPI document or JSON text. YAML must be parsed by the host. */
  readonly spec: Document | string
  /** Overrides the spec's `servers`. Required when the spec declares none. */
  readonly baseUrl?: string | undefined
  /** Values for templated server URL variables; spec defaults apply when omitted. */
  readonly serverVariables?: Readonly<Record<string, string>> | undefined
  /** Host credential resolution, keyed by security scheme name. */
  readonly auth?: { readonly resolve: AuthResolver } | undefined
  /**
   * Static headers applied to every request. Not model-visible, but a
   * spec-declared header parameter with the same name may override the value;
   * auth headers always win over both.
   */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** Curate which operations become tools. Defaults to all. */
  readonly operations?: ((operation: Operation) => boolean) | undefined
}

/** An operation that could not be represented as a tool, and why. */
export type Skipped = {
  readonly method: string
  readonly path: string
  readonly reason: string
}

/** Internal marker for "this operation/URL cannot be represented; report in `skipped`". */
type Skip = { readonly reason: string }

export type Tools = { readonly [name: string]: Definition<HttpClient.HttpClient> }

export type Result = {
  /** Tool subtree; the host places it under a key in its `tools` tree. */
  readonly tools: Tools
  readonly skipped: ReadonlyArray<Skipped>
}

const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])
const parameterLocations = new Set(["path", "query", "header", "cookie"])
const schemeTypes = new Set(["apiKey", "http", "oauth2", "openIdConnect"])
/** Upstream failure bodies are summarized for the model, capped to keep context small. */
const maxErrorBodyChars = 1_024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/**
 * Builds a CodeMode tool subtree from an OpenAPI 3.x document. One tool per
 * operation, named from `operationId` (sanitized) or `method_path`. Auth is
 * never part of the model-visible input: the adapter reads each operation's
 * effective `security`, asks `auth.resolve` for credentials by scheme name, and
 * injects them into the carrier the scheme declares. Generated tools require
 * `HttpClient.HttpClient` from the Effect environment; the host provides the
 * transport layer (e.g. `FetchHttpClient.layer`).
 *
 * Throws on structurally invalid specs. Operations that cannot be represented
 * (non-JSON request bodies, unresolved server templates) are reported in
 * `skipped` instead of producing broken tools.
 */
export const fromSpec = (options: Options): Result => {
  const document = parseDocument(options.spec)
  const schemes = securitySchemes(document)
  const defaultSecurity = securityRequirements(document.security)
  const definitions = componentDefinitions(document)
  const paths = isRecord(document.paths) ? document.paths : {}
  const base = options.baseUrl ?? specServerUrl(document, options.serverVariables ?? {})
  const used = new Set<string>()
  const skipped: Array<Skipped> = []
  const tools: { -readonly [K in keyof Tools]: Tools[K] } = {}

  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue
    for (const [method, operationValue] of Object.entries(pathValue)) {
      if (!methods.has(method) || !isRecord(operationValue)) continue
      const operation: Operation = {
        id: operationName(method, path, operationValue, used),
        method: method.toUpperCase(),
        path,
        summary: asString(operationValue.summary),
        description: asString(operationValue.description),
      }
      if (options.operations !== undefined && !options.operations(operation)) continue

      if (typeof base !== "string") {
        skipped.push({ method: operation.method, path, reason: base.reason })
        continue
      }
      const body = requestBody(document, operationValue)
      if (body !== undefined && "reason" in body) {
        skipped.push({ method: operation.method, path, reason: body.reason })
        continue
      }

      const security =
        operationValue.security === undefined ? defaultSecurity : securityRequirements(operationValue.security)
      const plan = {
        operation,
        url: `${base.replace(/\/+$/, "")}${path}`,
        parameters: operationParameters(document, pathValue, operationValue),
        body,
        security,
        schemes,
        auth: options.auth,
        headers: options.headers ?? {},
      }
      used.add(operation.id)
      tools[operation.id] = Tool.make({
        description: operation.description ?? operation.summary ?? `${operation.method} ${path}`,
        input: inputSchema(plan.parameters, body, definitions),
        output: outputSchema(document, operationValue, definitions),
        run: (input) => invoke(plan, input),
      })
    }
  }

  return { tools, skipped }
}

export const OpenAPI = { fromSpec }

// ---------------------------------------------------------------------------
// Spec parsing
// ---------------------------------------------------------------------------

const parseDocument = (spec: Document | string): Document => {
  if (typeof spec !== "string") return spec
  const parsed = JSON.parse(spec) as unknown
  if (!isRecord(parsed)) throw new Error("OpenAPI spec must be a JSON object.")
  return parsed
}

const pointerSegment = (segment: string) => segment.replaceAll("~1", "/").replaceAll("~0", "~")

const resolvePointer = (document: Document, ref: string): unknown => {
  if (!ref.startsWith("#/")) return undefined
  return ref
    .slice(2)
    .split("/")
    .map(pointerSegment)
    .reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), document)
}

/** Resolves a top-level `$ref` on parameter/requestBody/response objects. */
const resolve = (document: Document, value: unknown): unknown => {
  if (!isRecord(value)) return value
  const ref = asString(value.$ref)
  if (ref === undefined) return value
  return resolvePointer(document, ref) ?? value
}

// ---------------------------------------------------------------------------
// Schema projection - OpenAPI schema objects to render-only JsonSchema with
// `#/components/schemas/X` refs rewritten to `#/$defs/X` (the only ref form the
// signature renderer resolves).
// ---------------------------------------------------------------------------

const rewriteRef = (ref: string): string => {
  const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1]
  return name === undefined ? ref : `#/$defs/${name}`
}

const projectSchema = (value: unknown, depth = 0): JsonSchema => {
  if (depth > 24 || !isRecord(value)) return {}
  const ref = asString(value.$ref)
  if (ref !== undefined) return { $ref: rewriteRef(ref) }

  const type = Array.isArray(value.type)
    ? value.type.filter((item): item is string => typeof item === "string")
    : asString(value.type)
  const description = asString(value.description)
  const format = asString(value.format)
  const projected: JsonSchema = {
    ...(type === undefined ? {} : { type }),
    ...(Array.isArray(value.enum) ? { enum: value.enum } : {}),
    ...(value.const === undefined ? {} : { const: value.const }),
    ...(Array.isArray(value.anyOf) ? { anyOf: value.anyOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(Array.isArray(value.oneOf) ? { oneOf: value.oneOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(Array.isArray(value.allOf) ? { allOf: value.allOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(isRecord(value.properties)
      ? {
          properties: Object.fromEntries(
            Object.entries(value.properties).map(([key, item]) => [key, projectSchema(item, depth + 1)]),
          ),
        }
      : {}),
    ...(Array.isArray(value.required)
      ? { required: value.required.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(isRecord(value.items) ? { items: projectSchema(value.items, depth + 1) } : {}),
    ...(typeof value.additionalProperties === "boolean"
      ? { additionalProperties: value.additionalProperties }
      : isRecord(value.additionalProperties)
        ? { additionalProperties: projectSchema(value.additionalProperties, depth + 1) }
        : {}),
    ...(description === undefined ? {} : { description }),
    ...(value.default === undefined ? {} : { default: value.default }),
    ...(format === undefined ? {} : { format }),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(typeof value.minItems === "number" ? { minItems: value.minItems } : {}),
    ...(typeof value.maxItems === "number" ? { maxItems: value.maxItems } : {}),
  }
  // OpenAPI 3.0 nullable -> union with null, matching what 3.1 expresses via type arrays.
  if (value.nullable !== true) return projected
  if (Array.isArray(projected.type)) return { ...projected, type: [...projected.type, "null"] }
  if (typeof projected.type === "string") return { ...projected, type: [projected.type, "null"] }
  return { anyOf: [projected, { type: "null" }] }
}

/** All `components.schemas`, projected once and shared as `$defs` by every tool schema. */
const componentDefinitions = (document: Document): Readonly<Record<string, JsonSchema>> => {
  const components = isRecord(document.components) ? document.components : {}
  const schemas = isRecord(components.schemas) ? components.schemas : {}
  return Object.fromEntries(Object.entries(schemas).map(([name, value]) => [name, projectSchema(value)]))
}

const withDefinitions = (schema: JsonSchema, definitions: Readonly<Record<string, JsonSchema>>): JsonSchema =>
  Object.keys(definitions).length === 0 ? schema : { ...schema, $defs: definitions }

// ---------------------------------------------------------------------------
// Parameters and bodies
// ---------------------------------------------------------------------------

type ParameterLocation = "path" | "query" | "header" | "cookie"

type Parameter = {
  readonly name: string
  readonly location: ParameterLocation
  readonly required: boolean
  readonly schema: JsonSchema
}

const operationParameters = (
  document: Document,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): ReadonlyArray<Parameter> => {
  // Operation-level parameters override path-level ones sharing (location, name).
  const merged = new Map<string, Parameter>()
  for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const resolved = resolve(document, raw)
    if (!isRecord(resolved)) continue
    const name = asString(resolved.name)
    const location = asString(resolved.in)
    if (name === undefined || location === undefined || !parameterLocations.has(location)) continue
    const base = projectSchema(resolved.schema)
    merged.set(`${location}:${name}`, {
      name,
      location: location as ParameterLocation,
      required: resolved.required === true || location === "path",
      schema: { ...base, ...(base.description === undefined ? { description: asString(resolved.description) } : {}) },
    })
  }
  return [...merged.values()]
}

type Body = { readonly required: boolean; readonly schema: JsonSchema }

const requestBody = (document: Document, operation: Record<string, unknown>): Body | Skip | undefined => {
  const resolved = resolve(document, operation.requestBody)
  if (!isRecord(resolved)) return undefined
  const content = isRecord(resolved.content) ? resolved.content : {}
  const json = Object.entries(content).find(([mediaType]) => isJsonMediaType(mediaType))
  if (json === undefined) {
    const declared = Object.keys(content).join(", ") || "none"
    return { reason: `request body has no JSON content (declared: ${declared})` }
  }
  return {
    required: resolved.required === true,
    schema: isRecord(json[1]) ? projectSchema(json[1].schema) : {},
  }
}

const isJsonMediaType = (mediaType: string): boolean => {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? ""
  return normalized === "application/json" || normalized.endsWith("+json")
}

const inputSchema = (
  parameters: ReadonlyArray<Parameter>,
  body: Body | undefined,
  definitions: Readonly<Record<string, JsonSchema>>,
): JsonSchema => {
  const groups: ReadonlyArray<{ readonly name: string; readonly location: ParameterLocation }> = [
    { name: "path", location: "path" },
    { name: "query", location: "query" },
    { name: "headers", location: "header" },
    { name: "cookies", location: "cookie" },
  ]
  const grouped = groups.flatMap((group) => {
    const items = parameters.filter((parameter) => parameter.location === group.location)
    if (items.length === 0) return []
    const required = items.filter((item) => item.required).map((item) => item.name)
    const schema: JsonSchema = {
      type: "object",
      properties: Object.fromEntries(items.map((item) => [item.name, item.schema])),
      ...(required.length === 0 ? {} : { required }),
    }
    return [{ name: group.name, schema, required: required.length > 0 }]
  })
  const properties = Object.fromEntries([
    ...grouped.map((group) => [group.name, group.schema] as const),
    ...(body === undefined ? [] : [["body", body.schema] as const]),
  ])
  const required = [
    ...grouped.filter((group) => group.required).map((group) => group.name),
    ...(body?.required === true ? ["body"] : []),
  ]
  return withDefinitions(
    { type: "object", properties, ...(required.length === 0 ? {} : { required }) },
    definitions,
  )
}

const outputSchema = (
  document: Document,
  operation: Record<string, unknown>,
  definitions: Readonly<Record<string, JsonSchema>>,
): JsonSchema | undefined => {
  if (!isRecord(operation.responses)) return undefined
  const entries = Object.entries(operation.responses)
  // Literal 2xx codes, then the 2XX wildcard range, then default.
  const preferred = [
    ...entries.filter(([status]) => /^2\d\d$/.test(status)).sort(([a], [b]) => a.localeCompare(b)),
    ...entries.filter(([status]) => status.toUpperCase() === "2XX"),
    ...entries.filter(([status]) => status === "default"),
  ]
  for (const [, ref] of preferred) {
    const response = resolve(document, ref)
    if (!isRecord(response)) continue
    const content = isRecord(response.content) ? response.content : {}
    const json = Object.entries(content).find(([mediaType]) => isJsonMediaType(mediaType))
    if (json !== undefined && isRecord(json[1]) && json[1].schema !== undefined) {
      return withDefinitions(projectSchema(json[1].schema), definitions)
    }
    // Declared content without a usable JSON schema (e.g. text/plain): the tool
    // returns the raw body, so advertise unknown rather than a wrong null.
    if (Object.keys(content).length > 0) return undefined
  }
  // Success responses declared with no content at all (e.g. 204) resolve to
  // null. Without any recognized success/default response the shape is unknown.
  return preferred.length > 0 ? { type: "null" } : undefined
}

// ---------------------------------------------------------------------------
// Naming and servers
// ---------------------------------------------------------------------------

const operationName = (
  method: string,
  path: string,
  operation: Record<string, unknown>,
  used: ReadonlySet<string>,
): string => {
  const raw = asString(operation.operationId) ?? `${method}_${path.replaceAll(/[{}]/g, "")}`
  const base =
    raw
      .replaceAll(/[^A-Za-z0-9_$]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "operation"
  if (!used.has(base)) return base
  const next = (index: number): string => (used.has(`${base}_${index}`) ? next(index + 1) : `${base}_${index}`)
  return next(2)
}

const specServerUrl = (document: Document, variables: Readonly<Record<string, string>>): string | Skip => {
  const server = asArray(document.servers).find(isRecord)
  const url = server === undefined ? undefined : asString(server.url)
  if (url === undefined) return { reason: "spec declares no servers; pass baseUrl" }
  const defaults = isRecord(server?.variables) ? server.variables : {}
  const substituted = url.replaceAll(/\{([^{}]+)\}/g, (whole, name: string) => {
    const explicit = variables[name]
    if (explicit !== undefined) return explicit
    const declared = defaults[name]
    return (isRecord(declared) ? asString(declared.default) : undefined) ?? whole
  })
  if (/\{[^{}]+\}/.test(substituted)) {
    return { reason: `server URL has unresolved variables: ${url}; pass baseUrl or serverVariables` }
  }
  return substituted
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** One OR alternative: scheme name -> required scopes. Empty object = unauthenticated is acceptable. */
type SecurityRequirement = Readonly<Record<string, ReadonlyArray<string>>>

const securityRequirements = (value: unknown): ReadonlyArray<SecurityRequirement> =>
  asArray(value)
    .filter(isRecord)
    .map((requirement) =>
      Object.fromEntries(
        Object.entries(requirement).map(([name, scopes]) => [
          name,
          asArray(scopes).filter((scope): scope is string => typeof scope === "string"),
        ]),
      ),
    )

const securitySchemes = (document: Document): Readonly<Record<string, SecurityScheme>> => {
  const components = isRecord(document.components) ? document.components : {}
  const declared = isRecord(components.securitySchemes) ? components.securitySchemes : {}
  return Object.fromEntries(
    Object.entries(declared).flatMap(([name, value]) => {
      const resolved = resolve(document, value)
      if (!isRecord(resolved)) return []
      const type = asString(resolved.type)
      if (type === undefined || !schemeTypes.has(type)) return []
      const carrier = asString(resolved.in)
      return [
        [
          name,
          {
            name,
            type: type as SecurityScheme["type"],
            in: carrier === "header" || carrier === "query" || carrier === "cookie" ? carrier : undefined,
            parameterName: asString(resolved.name),
            scheme: asString(resolved.scheme)?.toLowerCase(),
          },
        ] as const,
      ]
    }),
  )
}

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

type Plan = {
  readonly operation: Operation
  readonly url: string
  readonly parameters: ReadonlyArray<Parameter>
  readonly body: Body | undefined
  readonly security: ReadonlyArray<SecurityRequirement>
  readonly schemes: Readonly<Record<string, SecurityScheme>>
  readonly auth: { readonly resolve: AuthResolver } | undefined
  readonly headers: Readonly<Record<string, string>>
}

/** Applied credentials for one satisfied security alternative. */
type AppliedAuth = {
  readonly headers: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly cookies: Readonly<Record<string, string>>
}

const invoke = (plan: Plan, input: unknown): Effect.Effect<unknown, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const value = isRecord(input) ? input : {}
    const path = isRecord(value.path) ? value.path : {}
    const query = isRecord(value.query) ? value.query : {}
    const headers = isRecord(value.headers) ? value.headers : {}
    const cookies = isRecord(value.cookies) ? value.cookies : {}

    const auth = yield* resolveAuth(plan)
    const url = yield* buildUrl(plan, path)

    let request = HttpClientRequest.make(plan.operation.method as HttpMethod.HttpMethod)(url)
    for (const parameter of plan.parameters) {
      if (parameter.location !== "query") continue
      const item = query[parameter.name]
      if (item === undefined || item === null) continue
      for (const rendered of queryValues(item)) {
        request = HttpClientRequest.appendUrlParam(request, parameter.name, rendered)
      }
    }
    for (const [name, item] of Object.entries(auth.query)) {
      request = HttpClientRequest.setUrlParam(request, name, item)
    }
    // Host headers first, then declared header params, then auth - auth must win.
    request = HttpClientRequest.setHeaders(request, plan.headers)
    for (const parameter of plan.parameters) {
      if (parameter.location !== "header") continue
      const item = headers[parameter.name]
      if (item === undefined || item === null) continue
      request = HttpClientRequest.setHeader(request, parameter.name, renderPrimitive(item))
    }
    const cookiePairs = [
      ...plan.parameters
        .filter((parameter) => parameter.location === "cookie")
        .flatMap((parameter) => {
          const item = cookies[parameter.name]
          return item === undefined || item === null ? [] : [`${parameter.name}=${renderPrimitive(item)}`]
        }),
      ...Object.entries(auth.cookies).map(([name, item]) => `${name}=${item}`),
    ]
    if (cookiePairs.length > 0) request = HttpClientRequest.setHeader(request, "cookie", cookiePairs.join("; "))
    request = HttpClientRequest.setHeaders(request, auth.headers)
    if (plan.body?.required === true && value.body === undefined) {
      return yield* Effect.fail(toolError("Missing required request body."))
    }
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
    const text = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
    const parsed = parseBody(text)
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        toolError(
          `${plan.operation.method} ${plan.operation.path} failed with HTTP ${response.status}: ${summarizeBody(parsed)}`,
        ),
      )
    }
    return parsed
  })

const parseBody = (text: string): unknown => {
  if (text === "") return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const summarizeBody = (body: unknown): string => {
  const rendered = typeof body === "string" ? body : (JSON.stringify(body) ?? "")
  if (rendered === "" || rendered === "null") return "no response body"
  return rendered.length > maxErrorBodyChars ? `${rendered.slice(0, maxErrorBodyChars)}...` : rendered
}

const renderPrimitive = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)

const queryValues = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.map(renderPrimitive) : [renderPrimitive(value)]

const buildUrl = (plan: Plan, path: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    let url = plan.url
    for (const parameter of plan.parameters) {
      if (parameter.location !== "path") continue
      const item = path[parameter.name]
      if (item === undefined || item === null) {
        return yield* Effect.fail(toolError(`Missing required path parameter '${parameter.name}'.`))
      }
      url = url.replaceAll(`{${parameter.name}}`, encodeURIComponent(renderPrimitive(item)))
    }
    const unresolved = url.match(/\{[^{}]+\}/)
    if (unresolved !== null) {
      return yield* Effect.fail(toolError(`Unresolved path parameter ${unresolved[0]}.`))
    }
    return url
  })

/**
 * Applies the operation's effective security. The requirement list is OR (first
 * satisfiable alternative wins, in spec order); schemes inside one requirement
 * are AND (all must resolve). `{}` in the list means unauthenticated is
 * acceptable. `resolve` returning `undefined` skips to the next alternative;
 * a `resolve` failure aborts the call.
 */
const resolveAuth = (plan: Plan): Effect.Effect<AppliedAuth, unknown> =>
  Effect.gen(function* () {
    const none: AppliedAuth = { headers: {}, query: {}, cookies: {} }
    if (plan.security.length === 0) return none

    const unavailable: Array<string> = []
    for (const requirement of plan.security) {
      const names = Object.keys(requirement)
      if (names.length === 0) return none

      const credentials: Array<readonly [SecurityScheme, Credential]> = []
      let satisfiable = true
      for (const name of names) {
        const scheme = plan.schemes[name]
        if (scheme === undefined || plan.auth === undefined) {
          unavailable.push(name)
          satisfiable = false
          break
        }
        const credential = yield* plan.auth.resolve({
          schemeName: name,
          scheme,
          scopes: requirement[name] ?? [],
          operation: plan.operation,
        })
        if (credential === undefined) {
          unavailable.push(name)
          satisfiable = false
          break
        }
        credentials.push([scheme, credential])
      }
      if (satisfiable) return yield* applyCredentials(plan.operation, credentials)
    }

    return yield* Effect.fail(
      toolError(
        `${plan.operation.method} ${plan.operation.path} requires authentication; no credential available for: ${[...new Set(unavailable)].join(", ")}.`,
      ),
    )
  })

const applyCredentials = (
  operation: Operation,
  credentials: ReadonlyArray<readonly [SecurityScheme, Credential]>,
): Effect.Effect<AppliedAuth, unknown> =>
  Effect.gen(function* () {
    const headers: Record<string, string> = {}
    const query: Record<string, string> = {}
    const cookies: Record<string, string> = {}
    // Two credentials landing on the same carrier cannot both be sent.
    const write = (target: Record<string, string>, name: string, value: string, carrier: string) => {
      if (target[name] !== undefined) {
        return Effect.fail(
          toolError(
            `${operation.method} ${operation.path} security requires two credentials on the '${name}' ${carrier}; this cannot be satisfied.`,
          ),
        )
      }
      target[name] = value
      return Effect.void
    }
    const setHeader = (name: string, value: string) => write(headers, name.toLowerCase(), value, "header")

    for (const [scheme, credential] of credentials) {
      if (credential.type === "bearer") {
        yield* setHeader("Authorization", `Bearer ${credential.token}`)
        continue
      }
      if (credential.type === "basic") {
        // Buffer instead of btoa: btoa throws on non-Latin-1 credentials.
        const encoded = Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")
        yield* setHeader("Authorization", `Basic ${encoded}`)
        continue
      }
      if (credential.type === "header") {
        yield* setHeader(credential.name, credential.value)
        continue
      }
      // apiKey: the carrier comes from the scheme declaration.
      const name = scheme.parameterName
      if (scheme.type !== "apiKey" || name === undefined || scheme.in === undefined) {
        return yield* Effect.fail(
          toolError(
            `Security scheme '${scheme.name}' is not an apiKey scheme; resolve a bearer, basic, or header credential for it.`,
          ),
        )
      }
      if (scheme.in === "header") yield* setHeader(name, credential.value)
      if (scheme.in === "query") yield* write(query, name, credential.value, "query parameter")
      if (scheme.in === "cookie") yield* write(cookies, name, credential.value, "cookie")
    }
    return { headers, query, cookies }
  })
