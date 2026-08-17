import { HttpClient } from "effect/unstable/http"
import { make, type Definition } from "../tool.js"
import { invoke } from "./runtime.js"
import {
  componentDefinitions,
  hasDirectionalSchemas,
  inputSchema,
  isRecord,
  methods,
  nonEmptyString,
  operationInput,
  operationOutput,
  operationPath,
  operationSecurityRequirements,
  securityRequirements,
  securitySchemes,
  specServerUrl,
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
 * Builds one CodeMode tool per representable OpenAPI 3.x operation. Auth remains host-side,
 * tools require `HttpClient.HttpClient`, and unrepresentable operations land in `skipped`.
 */
export const fromSpec = (options: Options): Result => {
  const document = options.spec
  const schemes = securitySchemes(document)
  const defaultSecurity = securityRequirements(document.security)
  const requestDefinitions = componentDefinitions(document, "request")
  const responseDefinitions = hasDirectionalSchemas(document)
    ? componentDefinitions(document, "response")
    : requestDefinitions
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
        operationId: nonEmptyString(operationValue.operationId),
        method: method.toUpperCase(),
        path,
        summary: nonEmptyString(operationValue.summary),
        description: nonEmptyString(operationValue.description),
      }
      const output = operationOutput(document, operationValue, responseDefinitions)
      if (!output.ok) {
        skipped.push({ method: operation.method, path, reason: output.reason })
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

      const security = operationSecurityRequirements(operationValue.security, defaultSecurity, schemes)
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
      used.add(segments.join("."))
      for (const index of segments.slice(0, -1).keys()) namespaces.add(segments.slice(0, index + 1).join("."))
      setTool(
        tools,
        segments,
        make({
          description: operation.description ?? operation.summary ?? `${operation.method} ${path}`,
          input: inputSchema(input.fields, requestDefinitions),
          output: output.value,
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
