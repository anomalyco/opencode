import { HttpClient } from "effect/unstable/http"
import { Tool, type Definition } from "../../tool.js"
import { invoke } from "./invoke.js"
import { componentDefinitions } from "./schema.js"
import { isRecord, methods, nonEmptyString } from "./shared.js"
import {
  inputSchema,
  operationName,
  operationParameters,
  outputSchema,
  requestBody,
  securityRequirements,
  securitySchemes,
  specServerUrl,
} from "./spec.js"
import type { Operation, Options, Result, Skipped } from "./types.js"

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
  const base = options.baseUrl ?? specServerUrl(document)
  const used = new Set<string>()
  const skipped: Array<Skipped> = []
  const tools = Object.create(null) as Record<string, Definition<HttpClient.HttpClient>>

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
