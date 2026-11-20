import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { ServerConnection } from "../../services/server-connection"

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
    const server = yield* ServerConnection.resolve({
      mismatch: "ignore",
    })
    const endpoint = server.endpoint
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
    if (!response.ok) {
      process.stderr.write(`HTTP ${response.status} ${response.statusText}${EOL}`)
      process.exitCode = 1
    }
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

export function rawRequest(input: readonly string[], params: Record<string, string> = {}) {
  if (input.length !== 2 || !methods.has(input[0].toLowerCase()) || !input[1].startsWith("/")) return
  return { method: input[0].toUpperCase(), path: interpolate(input[1], params) }
}

export function resolveRequest(endpoint: Endpoint, input: readonly string[], params: Record<string, string>) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => rawRequest(input, params),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if (raw) return raw
    if (input.length !== 1)
      return yield* Effect.fail(new Error("Expected an operation name or an HTTP method and path"))
    return yield* Effect.tryPromise(async () => {
      const response = await fetch(new URL("/openapi.json", endpoint.url), { headers: Service.headers(endpoint) })
      if (!response.ok) throw new Error(`Failed to load OpenAPI document: HTTP ${response.status}`)
      return resolveOperation((await response.json()) as OpenApi, input[0], params)
    })
  })
}

function interpolate(path: string, params: Record<string, string>) {
  // Placeholders only live in the pathname: braces in an existing query string or fragment are literal.
  const hashIndex = path.indexOf("#")
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex)
  const target = hashIndex === -1 ? path : path.slice(0, hashIndex)
  const queryIndex = target.indexOf("?")
  const search = queryIndex === -1 ? "" : target.slice(queryIndex + 1)

  const used = new Set<string>()
  const pathname = (queryIndex === -1 ? target : target.slice(0, queryIndex)).replaceAll(
    /\{([^}]+)\}/g,
    (_, name: string) => {
      if (!Object.hasOwn(params, name)) throw new Error(`Missing path parameter: ${name}`)
      used.add(name)
      return encodeURIComponent(params[name])
    },
  )

  // Send the user's query string as written unless --param adds to it; an explicit --param wins over a duplicate key.
  const extra = Object.entries(params).filter(([name]) => !used.has(name))
  if (!extra.length) return `${pathname}${search ? `?${search}` : ""}${hash}`
  const query = new URLSearchParams(search)
  extra.forEach(([name, value]) => query.set(name, value))
  return `${pathname}?${query}${hash}`
}
