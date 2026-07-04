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

      const base =
        options.baseUrl !== undefined
          ? validateBaseUrl(options.baseUrl)
          : specServerUrl(
              operationValue.servers !== undefined
                ? operationValue
                : pathValue.servers !== undefined
                  ? pathValue
                  : document,
            )
      if (typeof base !== "string") {
        skipped.push({ method: operation.method, path, reason: base.reason })
        continue
      }
      const input = operationInput(document, pathValue, operationValue)
      if ("reason" in input) {
        skipped.push({ method: operation.method, path, reason: input.reason })
        continue
      }

      const security =
        operationValue.security === undefined ? defaultSecurity : securityRequirements(operationValue.security)
      if ("reason" in security) {
        skipped.push({ method: operation.method, path, reason: security.reason })
        continue
      }
      const supportedSecurity = security.filter((requirement) =>
        Object.keys(requirement).every((name) => {
          const scheme = own(schemes, name)
          return scheme !== undefined && !(scheme.type === "apiKey" && scheme.in === "cookie")
        }),
      )
      if (security.length > 0 && supportedSecurity.length === 0) {
        const names = [...new Set(security.flatMap((requirement) => Object.keys(requirement)))]
        const cookieScheme = names.map((name) => own(schemes, name)).find((scheme) => scheme?.in === "cookie")
        skipped.push({
          method: operation.method,
          path,
          reason:
            cookieScheme === undefined
              ? `security requirement references missing or malformed scheme: ${names.join(", ")}`
              : `cookie authentication '${cookieScheme.name}' is not supported`,
        })
        continue
      }
      const plan = {
        operation,
        url: `${base.replace(/\/+$/, "")}${path}`,
        fields: input.fields,
        body: input.body,
        security: supportedSecurity,
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
