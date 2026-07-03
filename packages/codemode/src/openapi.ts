import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpMethod } from "effect/unstable/http"
import { ToolError, toolError } from "./tool-error.js"
import { Tool, type Definition, type JsonSchema } from "./tool.js"

/** A parsed OpenAPI 3.x document. YAML must be parsed by the host. */
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
 * comes from the scheme definition, not the credential. `header` is the escape
 * hatch for nonstandard schemes.
 */
export type Credential =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "apiKey"; readonly value: string }
  | { readonly type: "header"; readonly name: string; readonly value: string }

/**
 * Resolves credential material for one named security scheme at call time.
 * `undefined` means unavailable, try the next OR alternative; a failure aborts
 * the call rather than falling through.
 */
export type AuthResolver = (context: {
  readonly schemeName: string
  readonly scheme: SecurityScheme
  readonly scopes: ReadonlyArray<string>
  readonly operation: Operation
}) => Effect.Effect<Credential | undefined, unknown>

export type Options = {
  readonly spec: Document
  /** Overrides the spec's `servers` (only the first entry is used). Required when the spec has no absolute server URL. */
  readonly baseUrl?: string | undefined
  /** Host credential resolution, keyed by security scheme name. */
  readonly auth?: { readonly resolve: AuthResolver } | undefined
  /** Static headers on every request. Not model-visible; declared header params may override them, auth always wins. */
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

/** Unrepresentable; reported in `skipped`. */
type Skip = { readonly reason: string }

export type Tools = { readonly [name: string]: Definition<HttpClient.HttpClient> }

export type Result = {
  /** Tool subtree; the host places it under a key in its `tools` tree. */
  readonly tools: Tools
  readonly skipped: ReadonlyArray<Skipped>
}

const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])
const parameterLocations = new Set(["path", "query", "header"])
// OpenAPI: header parameters with these names SHALL be ignored.
const ignoredHeaderParameters = new Set(["accept", "content-type", "authorization"])
const schemeTypes = new Set(["apiKey", "http", "oauth2", "openIdConnect"])
const maxErrorBodyChars = 1_024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

/**
 * Builds a CodeMode tool subtree from an OpenAPI 3.x document, one tool per
 * operation. Auth is never model-visible: credentials come from `auth.resolve`
 * per the operation's effective `security` and are injected into the carrier
 * the scheme declares. Generated tools require `HttpClient.HttpClient` from the
 * Effect environment. Unrepresentable operations land in `skipped`.
 */
export const fromSpec = (options: Options): Result => {
  const document = options.spec
  const schemes = securitySchemes(document)
  const defaultSecurity = securityRequirements(document.security)
  const definitions = componentDefinitions(document)
  const paths = isRecord(document.paths) ? document.paths : {}
  const base = options.baseUrl ?? specServerUrl(document)
  const used = new Set<string>()
  const skipped: Array<Skipped> = []
  const tools: Record<string, Definition<HttpClient.HttpClient>> = {}

  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue
    for (const [method, operationValue] of Object.entries(pathValue)) {
      if (!methods.has(method) || !isRecord(operationValue)) continue
      const operation: Operation = {
        id: operationName(method, path, operationValue, used),
        method: method.toUpperCase(),
        path,
        summary: nonEmptyString(operationValue.summary),
        description: nonEmptyString(operationValue.description),
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

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

/** Resolves a top-level `$ref` on parameter/requestBody/response objects. */
const resolve = (document: Document, value: unknown): unknown => {
  if (!isRecord(value)) return value
  const ref = nonEmptyString(value.$ref)
  if (ref === undefined || !ref.startsWith("#/")) return value
  const target = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, segment) => (isRecord(current) ? current[segment] : undefined), document)
  return target ?? value
}

// ---------------------------------------------------------------------------
// Schema projection
// ---------------------------------------------------------------------------

const projectSchema = (value: unknown, depth = 0): JsonSchema => {
  if (depth > 24 || !isRecord(value)) return {}
  const ref = nonEmptyString(value.$ref)
  if (ref !== undefined) {
    // `#/components/schemas/X` becomes `#/$defs/X`, the only ref form the signature renderer resolves.
    const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1]
    return { $ref: name === undefined ? ref : `#/$defs/${name.replaceAll("~1", "/").replaceAll("~0", "~")}` }
  }

  const type = Array.isArray(value.type)
    ? value.type.filter((item): item is string => typeof item === "string")
    : nonEmptyString(value.type)
  const description = nonEmptyString(value.description)
  const format = nonEmptyString(value.format)
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

type ParameterLocation = "path" | "query" | "header"

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
    const name = nonEmptyString(resolved.name)
    const location = nonEmptyString(resolved.in)
    if (name === undefined || location === undefined || !parameterLocations.has(location)) continue
    if (location === "header" && ignoredHeaderParameters.has(name.toLowerCase())) continue
    const base = projectSchema(resolved.schema)
    const description = nonEmptyString(resolved.description)
    merged.set(`${location}:${name}`, {
      name,
      location: location as ParameterLocation,
      required: resolved.required === true || location === "path",
      schema: {
        ...base,
        ...(base.description === undefined && description !== undefined ? { description } : {}),
      },
    })
  }
  return [...merged.values()]
}

type Body = { readonly required: boolean; readonly schema: JsonSchema }

const requestBody = (document: Document, operation: Record<string, unknown>): Body | Skip | undefined => {
  const resolved = resolve(document, operation.requestBody)
  if (!isRecord(resolved)) return undefined
  const content = isRecord(resolved.content) ? resolved.content : {}
  if (!Object.keys(content).some(isJsonMediaType)) {
    const declared = Object.keys(content).join(", ") || "none"
    return { reason: `request body has no JSON content (declared: ${declared})` }
  }
  return {
    required: resolved.required === true,
    schema: projectSchema(jsonContentSchema(content)),
  }
}

const isJsonMediaType = (mediaType: string): boolean => {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? ""
  return normalized === "application/json" || normalized.endsWith("+json")
}

const jsonContentSchema = (content: Record<string, unknown>): unknown => {
  const entry = Object.entries(content).find(([mediaType]) => isJsonMediaType(mediaType))
  return entry !== undefined && isRecord(entry[1]) ? entry[1].schema : undefined
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
  return withDefinitions({ type: "object", properties, ...(required.length === 0 ? {} : { required }) }, definitions)
}

const outputSchema = (
  document: Document,
  operation: Record<string, unknown>,
  definitions: Readonly<Record<string, JsonSchema>>,
): JsonSchema | undefined => {
  if (!isRecord(operation.responses)) return undefined
  const entries = Object.entries(operation.responses)
  const successes = [
    ...entries.filter(([status]) => /^2\d\d$/.test(status)).sort(([a], [b]) => a.localeCompare(b)),
    ...entries.filter(([status]) => status.toUpperCase() === "2XX"),
  ]
    .map(([, ref]) => resolve(document, ref))
    .filter(isRecord)
  for (const response of successes) {
    const schema = jsonContentSchema(isRecord(response.content) ? response.content : {})
    if (schema !== undefined) return withDefinitions(projectSchema(schema), definitions)
  }
  // Declared non-JSON content (e.g. text/plain) returns the raw body -> unknown.
  const declaresContent = successes.some(
    (response) => isRecord(response.content) && Object.keys(response.content).length > 0,
  )
  if (declaresContent) return undefined
  // No-content success (e.g. 204) -> null.
  return successes.length > 0 ? { type: "null" } : undefined
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
  const raw = nonEmptyString(operation.operationId) ?? `${method}_${path.replaceAll(/[{}]/g, "")}`
  const base =
    raw
      .replaceAll(/[^A-Za-z0-9_$]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "operation"
  if (!used.has(base)) return base
  const next = (index: number): string => (used.has(`${base}_${index}`) ? next(index + 1) : `${base}_${index}`)
  return next(2)
}

const specServerUrl = (document: Document): string | Skip => {
  const server = asArray(document.servers).find(isRecord)
  const url = server === undefined ? undefined : nonEmptyString(server.url)
  if (url === undefined) return { reason: "spec declares no servers; pass baseUrl" }
  // Templated or relative server URLs cannot be resolved by the adapter.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /\{[^{}]+\}/.test(url)) {
    return { reason: `server URL '${url}' is not an absolute URL; pass baseUrl` }
  }
  return url
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
      const type = nonEmptyString(resolved.type)
      if (type === undefined || !schemeTypes.has(type)) return []
      const carrier = nonEmptyString(resolved.in)
      return [
        [
          name,
          {
            name,
            type: type as SecurityScheme["type"],
            in: carrier === "header" || carrier === "query" || carrier === "cookie" ? carrier : undefined,
            parameterName: nonEmptyString(resolved.name),
            scheme: nonEmptyString(resolved.scheme)?.toLowerCase(),
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
    const query = isRecord(value.query) ? value.query : {}
    const headers = isRecord(value.headers) ? value.headers : {}

    // Local validation before auth resolution, which may refresh tokens.
    const url = buildUrl(plan, isRecord(value.path) ? value.path : {})
    if (url instanceof ToolError) return yield* Effect.fail(url)
    if (plan.body?.required === true && value.body === undefined) {
      return yield* Effect.fail(toolError("Missing required request body."))
    }

    const auth = yield* resolveAuth(plan)

    let request = HttpClientRequest.make(plan.operation.method as HttpMethod.HttpMethod)(url)
    for (const parameter of plan.parameters) {
      if (parameter.location !== "query") continue
      const item = query[parameter.name]
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
      const item = headers[parameter.name]
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
    const item = path[parameter.name]
    if (item === undefined || item === null) {
      return toolError(`Missing required path parameter '${parameter.name}'.`)
    }
    url = url.replaceAll(`{${parameter.name}}`, encodeURIComponent(renderPrimitive(item)))
  }
  const unresolved = url.match(/\{[^{}]+\}/)
  if (unresolved !== null) return toolError(`Unresolved path parameter ${unresolved[0]}.`)
  return url
}

/**
 * Applies the operation's effective security: the first satisfiable OR
 * alternative wins in spec order, every scheme within it must resolve (AND),
 * and `{}` means unauthenticated is acceptable.
 */
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
        const scheme = plan.schemes[name]
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
