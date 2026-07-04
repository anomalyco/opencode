import { HttpClient } from "effect/unstable/http"
import { Tool, type Definition } from "../tool.js"
import { invoke } from "./runtime.js"
import {
  componentDefinitions,
  inputSchema,
  isRecord,
  methods,
  nonEmptyString,
  operationInput,
  operationPath,
  own,
  outputSchema,
  securityRequirements,
  securitySchemes,
  specServerUrl,
  unsupportedOperationReason,
  validateBaseUrl,
} from "./spec.js"
import type { Operation, Options, Result, Skipped, Tools } from "./types.js"

export type {
  AuthResolver,
  Credential,
  Document,
  Operation,
  Options,
  Result,
  SecurityScheme,
  Skipped,
  Tools,
} from "./types.js"

/**
 * Builds a CodeMode tool subtree from an OpenAPI 3.x document, one tool per
 * operation. Auth is resolved host-side via `auth.resolve` and never
 * model-visible. Tools require `HttpClient.HttpClient`; unrepresentable
 * operations land in `skipped`.
 */
export const fromSpec = (options: Options): Result => {
  const document = options.spec
  const schemes = securitySchemes(document)
  const defaultSecurity = securityRequirements(document.security)
  const definitions = componentDefinitions(document)
  const paths = isRecord(document.paths) ? document.paths : {}
  const used = new Set<string>()
  const namespaces = new Set<string>()
  const skipped: Array<Skipped> = []
  const tools = Object.create(null) as Tools

  for (const [path, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue
    for (const [method, operationValue] of Object.entries(pathValue)) {
      if (!methods.has(method) || !isRecord(operationValue)) continue
      const segments = operationPath(method, path, operationValue, used, namespaces)
      const operation: Operation = {
        id: segments.join("."),
        method: method.toUpperCase(),
        path,
        summary: nonEmptyString(operationValue.summary),
        description: nonEmptyString(operationValue.description),
      }
      if (options.operations !== undefined && !options.operations(operation)) continue
      // TODO: Represent streaming transports as explicit host capabilities before
      // exposing them as callable CodeMode tools.
      const unsupported = unsupportedOperationReason(document, operationValue)
      if (unsupported !== undefined) {
        skipped.push({ method: operation.method, path, reason: unsupported })
        continue
      }

      const resolvedBaseUrl = (() => {
        if (options.baseUrl !== undefined) return validateBaseUrl(options.baseUrl)
        if (operationValue.servers !== undefined) return specServerUrl(operationValue)
        if (pathValue.servers !== undefined) return specServerUrl(pathValue)
        return specServerUrl(document)
      })()
      if (!resolvedBaseUrl.ok) {
        skipped.push({ method: operation.method, path, reason: resolvedBaseUrl.reason })
        continue
      }
      const parsedInput = operationInput(document, pathValue, operationValue)
      if (!parsedInput.ok) {
        skipped.push({ method: operation.method, path, reason: parsedInput.reason })
        continue
      }
      const input = parsedInput.value

      const security = (() => {
        const parsed =
          operationValue.security === undefined ? defaultSecurity : securityRequirements(operationValue.security)
        if (!parsed.ok) return parsed
        const supported = parsed.value.filter((requirement) =>
          Object.keys(requirement).every((name) => {
            const scheme = own(schemes, name)
            return scheme !== undefined && !(scheme.type === "apiKey" && scheme.in === "cookie")
          }),
        )
        if (parsed.value.length === 0 || supported.length > 0) return { ok: true, value: supported } as const

        const names = [...new Set(parsed.value.flatMap((requirement) => Object.keys(requirement)))]
        const cookieScheme = names.map((name) => own(schemes, name)).find((scheme) => scheme?.in === "cookie")
        return {
          ok: false,
          reason:
            cookieScheme === undefined
              ? `security requirement references missing or malformed scheme: ${names.join(", ")}`
              : `cookie authentication '${cookieScheme.name}' is not supported`,
        } as const
      })()
      if (!security.ok) {
        skipped.push({ method: operation.method, path, reason: security.reason })
        continue
      }
      const plan = {
        operation,
        url: `${resolvedBaseUrl.value.replace(/\/+$/, "")}${path}`,
        fields: input.fields,
        body: input.body,
        security: security.value,
        schemes,
        auth: options.auth,
        headers: options.headers ?? {},
      }
      used.add(operation.id)
      for (const index of segments.slice(0, -1).keys()) namespaces.add(segments.slice(0, index + 1).join("."))
      setTool(
        tools,
        segments,
        Tool.make({
          description: operation.description ?? operation.summary ?? `${operation.method} ${path}`,
          input: inputSchema(input.fields, definitions),
          output: outputSchema(document, operationValue, definitions),
          run: (input) => invoke(plan, input),
        }),
      )
    }
  }

  return { tools, skipped }
}

const setTool = (tools: Tools, path: ReadonlyArray<string>, definition: Definition<HttpClient.HttpClient>): void => {
  const [head, ...rest] = path
  if (head === undefined) return
  if (rest.length === 0) {
    tools[head] = definition
    return
  }
  const child = tools[head]
  if (child === undefined || !isRecord(child) || child._tag === "CodeModeTool") {
    tools[head] = Object.create(null) as Tools
  }
  setTool(tools[head] as Tools, rest, definition)
}
