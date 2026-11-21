import { EOL } from "node:os"
import { Effect, Option, Predicate } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { ServerConnection } from "../../services/server-connection"

const methods = new Set(["delete", "get", "head", "options", "patch", "post", "put"])
const brokenPipeCodes = new Set(["EPIPE", "EOF", "ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_DESTROYED"])

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

    const controller = new AbortController()
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        withAbort(
          signal,
          () => controller.abort(),
          () =>
            fetch(new URL(request.path, endpoint.url), {
              method: request.method,
              headers,
              body,
              signal: controller.signal,
            }),
        ),
      catch: (cause) => cause,
    })
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    if (response.ok && mediaType === "text/event-stream" && response.body) {
      const stream = response.body
      yield* Effect.tryPromise({
        try: (signal) =>
          withAbort(
            signal,
            () => controller.abort(),
            () => streamEvents(stream, process.stdout, () => controller.abort()),
          ),
        catch: (cause) => cause,
      })
      return
    }
    const output = yield* Effect.promise(() => response.text())
    if (output) process.stdout.write(output + (output.endsWith(EOL) ? "" : EOL))
    if (!response.ok) {
      process.stderr.write(`HTTP ${response.status} ${response.statusText}${EOL}`)
      process.exitCode = 1
    }
  }),
)

export async function streamEvents(
  stream: ReadableStream<Uint8Array>,
  output: NodeJS.WritableStream,
  abort?: () => void,
) {
  if ("destroyed" in output && output.destroyed) {
    abort?.()
    await stream.cancel().catch(() => {})
    return
  }
  let streamError: unknown
  let broken = false
  let handledError: unknown
  const onStreamError = (error: unknown) => {
    streamError = error
  }
  output.on("error", onStreamError)
  const reader = stream.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      const failure = (await writeChunk(output, next.value)) ?? streamError
      if (failure === undefined) continue
      if (isBrokenPipe(failure)) {
        broken = true
        abort?.()
        await reader.cancel().catch(() => {})
        return
      }
      handledError = failure
      abort?.()
      await reader.cancel().catch(() => {})
      throw failure
    }
  } finally {
    reader.releaseLock()
    if (broken) output.on("error", ignoreBrokenPipe)
    if (!broken && handledError !== undefined && streamError === undefined) {
      const swallow = (error: unknown) => {
        if (error !== handledError) throw error
      }
      output.once("error", swallow)
      setImmediate(() => output.off("error", swallow))
    }
    output.off("error", onStreamError)
  }
}

function withAbort<A>(signal: AbortSignal, onAbort: () => void, run: () => Promise<A>) {
  if (signal.aborted) onAbort()
  signal.addEventListener("abort", onAbort, { once: true })
  return run().finally(() => signal.removeEventListener("abort", onAbort))
}

function writeChunk(output: NodeJS.WritableStream, chunk: Uint8Array) {
  return new Promise<unknown>((resolve) => {
    const onError = (error: unknown) => {
      cleanup()
      resolve(error)
    }
    const cleanup = () => {
      output.off("error", onError)
    }
    output.once("error", onError)
    try {
      output.write(chunk, (error) => {
        cleanup()
        resolve(error ?? undefined)
      })
    } catch (error) {
      cleanup()
      resolve(error)
    }
  })
}

function isBrokenPipe(error: unknown) {
  return Predicate.hasProperty(error, "code") && typeof error.code === "string" && brokenPipeCodes.has(error.code)
}

function ignoreBrokenPipe(error: unknown) {
  if (isBrokenPipe(error)) return
  throw error
}

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

function resolveRequest(endpoint: Endpoint, input: readonly string[], params: Record<string, string>) {
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
