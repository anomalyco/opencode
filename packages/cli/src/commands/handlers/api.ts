import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Service } from "@opencode-ai/client/effect"
import { ServiceConfig } from "../../services/service-config"

const methods = new Set(["delete", "get", "head", "options", "patch", "post", "put"])

type Operation = {
  operationId?: string
}

type OpenApi = {
  paths?: Record<string, Record<string, Operation>>
}

export default Runtime.handler(
  Commands.commands.api,
  Effect.fn("cli.api")(function* (input) {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover(options)
    const endpoint = found ?? (yield* Service.start(options))
    const params = Option.getOrElse(input.param, () => ({}))
    const request = yield* resolveRequest(endpoint, input.request, params)
    const headers = new Headers(Service.headers(endpoint))
    for (const header of input.header) {
      const index = header.indexOf(":")
      if (index < 1) return yield* Effect.fail(new Error(`Invalid header, expected name:value: ${header}`))
      headers.set(header.slice(0, index).trim(), header.slice(index + 1).trim())
    }
    const body = Option.getOrUndefined(input.data)
    if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")

    const response = yield* Effect.tryPromise(() =>
      fetch(new URL(request.path, endpoint.url), {
        method: request.method,
        headers,
        body,
      }),
    )
    const output = yield* Effect.promise(() => response.text())
    if (output) process.stdout.write(output + (output.endsWith(EOL) ? "" : EOL))
  }),
)

export function resolveOperation(spec: OpenApi, operationID: string, params: Record<string, string>) {
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method) || operation.operationId !== operationID) continue
      return { method: method.toUpperCase(), path: interpolate(path, params) }
    }
  }
  throw new Error(`Operation not found: ${operationID}`)
}

export function rawRequest(input: readonly string[]) {
  if (input.length !== 2 || !methods.has(input[0].toLowerCase()) || !input[1].startsWith("/")) return
  return { method: input[0].toUpperCase(), path: input[1] }
}

function resolveRequest(
  endpoint: Service.Endpoint,
  input: readonly string[],
  params: Record<string, string>,
) {
  const raw = rawRequest(input)
  if (raw) return Effect.succeed(raw)
  if (input.length !== 1) return Effect.fail(new Error("Expected an operation name or an HTTP method and path"))
  return Effect.tryPromise(async () => {
    const response = await fetch(new URL("/openapi.json", endpoint.url), { headers: Service.headers(endpoint) })
    if (!response.ok) throw new Error(`Failed to load OpenAPI document: HTTP ${response.status}`)
    return resolveOperation((await response.json()) as OpenApi, input[0], params)
  })
}

function interpolate(path: string, params: Record<string, string>) {
  const used = new Set<string>()
  const pathname = path.replaceAll(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing path parameter: ${name}`)
    used.add(name)
    return encodeURIComponent(value)
  })
  const query = new URLSearchParams(Object.entries(params).filter(([name]) => !used.has(name))).toString()
  return query ? `${pathname}?${query}` : pathname
}
