import { fileURLToPath } from "node:url"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import type { JsonValue, OpenCodeConfig, Setup as ProjectSetup } from "../project.js"
import {
  Failure,
  ControlError,
  ShellInput,
  ShellResult,
  WebFetchInput,
  WebFetchResult,
  WebSearchInput,
  WebSearchResult,
  WriteInput,
  WriteResult,
  type Configuration,
  type ControlledCall,
  type ControlledCalls,
  type ControlledCallsFor,
  type StaticControls,
  type Handler,
  type Name,
  type Registration,
  type Registry,
  type ShellHandler,
  type WebFetchHandler,
  type WebSearchHandler,
  type WriteHandler,
} from "./types.js"

type Result = ShellResult | WebFetchResult | WebSearchResult | WriteResult
type Event =
  | { readonly type: "progress"; readonly result: Result }
  | { readonly type: "success"; readonly result: Result }
  | { readonly type: "failure"; readonly message: string }
type BackgroundCompletion = {
  readonly shellID: string
  readonly command: string
  readonly state: "completed" | "error" | "cancelled"
  readonly output: string
}
type BackgroundJob = {
  readonly input: string
  readonly completion: Promise<BackgroundCompletion>
  readonly cancel: () => void
}
type Definition = {
  readonly schema: typeof ShellInput | typeof WebFetchInput | typeof WebSearchInput | typeof WriteInput
  readonly invoke: (
    input: unknown,
    index: number,
    id: string,
    progress: (result: Result) => Effect.Effect<void>,
  ) => Effect.Effect<Result, unknown>
}

const MAX_EVENT_BYTES = 1024 * 1024
const ExecutionRequest = Schema.Struct({
  input: Schema.Unknown,
  context: Schema.Struct({
    callID: Schema.String,
  }),
})
const encoder = new TextEncoder()

function controlError(
  operation: ControlError["operation"],
  reason: ControlError["reason"],
  name: Name,
  callID?: string,
) {
  const message =
    reason === "not-controlled"
      ? `tool is not configured for runtime control: ${name}`
      : reason === "controller-closed"
        ? callID === undefined
          ? `tool controller is closed: ${name}`
          : `${name} tool call ${callID} was interrupted because the controller closed`
        : reason === "already-claimed"
          ? `${name} tool call already claimed: ${callID}`
          : reason === "already-settled"
            ? `${name} tool call ${callID} is settled`
            : `${name} tool call ${callID} is interrupted`
  return new ControlError({ operation, reason, name, callID, message })
}

export interface Controller {
  readonly enabled: boolean
  readonly controls: StaticControls
  readonly configure: (config: OpenCodeConfig) => void
  readonly names: ReadonlySet<string>
}

export function composeSetup(controller: Controller, setup: ProjectSetup | undefined): ProjectSetup | undefined {
  if (!controller.enabled && setup === undefined) return undefined
  return (context) =>
    Effect.suspend(() => {
      const configured: unknown = setup === undefined ? Effect.void : setup(context)
      if (!isEffect(configured)) return Effect.fail(new Error("setup must return an Effect"))
      return configured.pipe(Effect.asVoid, Effect.andThen(Effect.sync(() => controller.configure(context.config))))
    })
}

function isEffect(value: unknown): value is Effect.Effect<unknown, unknown> {
  return Effect.isEffect(value)
}

export const make = Effect.fn("ToolController.make")(function* (configuration?: Configuration) {
  const definitions = new Map<string, Definition>()
  const closeControls: Array<Effect.Effect<void>> = []
  let closed = false
  const controlledCalls: {
    [Tool in Name]?: ControlledCallsFor<Tool>
  } = {}
  const add = (name: string, definition: Definition) => {
    if (definitions.has(name)) throw new Error(`tool handler already registered: ${name}`)
    definitions.set(name, definition)
  }
  function handle(name: "shell", handler: ShellHandler): void
  function handle(name: "webfetch", handler: WebFetchHandler): void
  function handle(name: "websearch", handler: WebSearchHandler): void
  function handle(name: "write", handler: WriteHandler): void
  function handle(...registration: Registration) {
    switch (registration[0]) {
      case "shell": {
        const handler = registration[1]
        add("shell", {
          schema: ShellInput,
          invoke: (raw, index, id, progress) =>
            Effect.gen(function* () {
              const input = yield* Schema.decodeUnknownEffect(ShellInput)(raw)
              const result = yield* handler({
                id,
                input,
                index,
                progress: (value) => progress(typeof value === "string" ? { output: value } : value),
              })
              return yield* Schema.decodeUnknownEffect(ShellResult)(result)
            }),
        })
        return
      }
      case "webfetch": {
        const handler = registration[1]
        add("webfetch", {
          schema: WebFetchInput,
          invoke: (raw, index, id, progress) =>
            Effect.gen(function* () {
              const input = yield* Schema.decodeUnknownEffect(WebFetchInput)(raw)
              const result = yield* handler({
                id,
                input,
                index,
                progress: (value) => progress(typeof value === "string" ? { output: value } : value),
              })
              return yield* Schema.decodeUnknownEffect(WebFetchResult)(result)
            }),
        })
        return
      }
      case "websearch": {
        const handler = registration[1]
        add("websearch", {
          schema: WebSearchInput,
          invoke: (raw, index, id, progress) =>
            Effect.gen(function* () {
              const input = yield* Schema.decodeUnknownEffect(WebSearchInput)(raw)
              const result = yield* handler({
                id,
                input,
                index,
                progress: (value) => progress(typeof value === "string" ? { output: value } : value),
              })
              return yield* Schema.decodeUnknownEffect(WebSearchResult)(result)
            }),
        })
        return
      }
      case "write": {
        const handler = registration[1]
        add("write", {
          schema: WriteInput,
          invoke: (raw, index, id, progress) =>
            Effect.gen(function* () {
              const input = yield* Schema.decodeUnknownEffect(WriteInput)(raw)
              const result = yield* handler({
                id,
                input,
                index,
                progress: (value) => progress(typeof value === "string" ? { output: value } : value),
              })
              return yield* Schema.decodeUnknownEffect(WriteResult)(result)
            }),
        })
      }
    }
  }
  const registry: Registry = { handle }
  if (typeof configuration === "function") configuration(registry)
  if (Array.isArray(configuration)) {
    for (const name of configuration) {
      switch (name) {
        case "shell": {
          const controlled = makeControlledHandler<ShellInput, ShellResult>("shell")
          handle("shell", controlled.handler)
          controlledCalls.shell = controlled.calls
          closeControls.push(controlled.close)
          break
        }
        case "webfetch": {
          const controlled = makeControlledHandler<WebFetchInput, WebFetchResult>("webfetch")
          handle("webfetch", controlled.handler)
          controlledCalls.webfetch = controlled.calls
          closeControls.push(controlled.close)
          break
        }
        case "websearch": {
          const controlled = makeControlledHandler<WebSearchInput, WebSearchResult>("websearch")
          handle("websearch", controlled.handler)
          controlledCalls.websearch = controlled.calls
          closeControls.push(controlled.close)
          break
        }
        case "write": {
          const controlled = makeControlledHandler<WriteInput, WriteResult>("write")
          handle("write", controlled.handler)
          controlledCalls.write = controlled.calls
          closeControls.push(controlled.close)
          break
        }
        default:
          throw new Error(`unsupported controlled tool: ${String(name)}`)
      }
    }
  }
  function control<Tool extends Name>(name: Tool): Effect.Effect<ControlledCallsFor<Tool>, ControlError> {
    if (closed) return Effect.fail(controlError("control", "controller-closed", name))
    const calls = controlledCalls[name]
    return calls === undefined ? Effect.fail(controlError("control", "not-controlled", name)) : Effect.succeed(calls)
  }
  const controls: StaticControls = { control }
  if (definitions.size === 0) return { enabled: false, controls, configure() {}, names: new Set() } satisfies Controller

  const token = crypto.randomUUID()
  const indexes = new Map<string, number>()
  const active = new Map<AbortController, Promise<unknown>>()
  const background = new Map<string, BackgroundJob>()
  let closing = false
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 255,
        fetch(request) {
          if (request.headers.get("authorization") !== `Bearer ${token}`)
            return new Response("Unauthorized", { status: 401 })
          if (closing && request.method === "POST") return new Response("Tool controller is stopping", { status: 503 })
          const pathname = new URL(request.url).pathname
          const shellID = pathname.match(/^\/background\/([^/]+)$/)?.[1]
          if (request.method === "GET" && shellID !== undefined) {
            const job = background.get(shellID)
            if (job === undefined) return new Response("Background shell not found", { status: 404 })
            server.timeout(request, 0)
            return job.completion.then((completion) => Response.json(completion))
          }
          if (request.method === "DELETE" && shellID !== undefined) {
            background.delete(shellID)
            return new Response(null, { status: 204 })
          }
          const name = pathname.match(/^\/execute\/([^/]+)$/)?.[1]
          const definition = name === undefined ? undefined : definitions.get(name)
          if (request.method !== "POST" || name === undefined) return new Response("Not found", { status: 404 })
          if (definition === undefined) return new Response("Tool handler not registered", { status: 404 })
          return execute(request, name, definition, indexes, active, background)
        },
      }),
    ),
    (server) =>
      Effect.gen(function* () {
        closing = true
        closed = true
        yield* Effect.all(closeControls, { discard: true })
        yield* Effect.sync(() => {
          for (const controller of active.keys()) controller.abort(new Error("Drive tool controller stopped"))
        })
        yield* Effect.promise(() => Promise.allSettled(active.values()))
        background.clear()
        yield* Effect.promise(() => server.stop(true))
      }),
  )
  const endpoint = `http://${server.hostname}:${server.port}`
  const plugin = fileURLToPath(new URL("./plugin.js", import.meta.url))
  const schemas = Object.fromEntries(
    [...definitions].map(([name, definition]) => [
      name,
      JSON.parse(JSON.stringify(Schema.toJsonSchemaDocument(definition.schema).schema)),
    ]),
  )

  return {
    enabled: true,
    controls,
    names: new Set(definitions.keys()),
    configure(config) {
      const current = config.plugins
      if (current !== undefined && !Array.isArray(current)) throw new Error("OpenCode config plugins must be an array")
      config.plugins = [
        ...(current ?? []),
        {
          package: plugin,
          options: { endpoint, token, tools: [...definitions.keys()], schemas },
        },
      ] as JsonValue
    },
  } satisfies Controller
})

function makeControlledHandler<Input, Output>(
  name: Name,
): {
  readonly calls: ControlledCalls<Input, Output>
  readonly handler: Handler<Input, Output>
  readonly close: Effect.Effect<void>
} {
  type Call = ControlledCall<Input, Output>
  type Waiter = {
    readonly id?: string
    readonly resume: (effect: Effect.Effect<Call, ControlError>) => void
    delivered?: Active
  }
  type Interruption = "transport-interrupted" | "controller-closed"
  type Active = {
    readonly call: Call
    claimed: boolean
    readonly interrupt: (reason: Interruption) => void
  }

  const records = new Map<string, Active>()
  const waiters: Waiter[] = []
  let closed = false

  const deliver = (record: Active) => {
    // A caller waiting for this exact ID wins over an earlier generic waiter.
    const exact = waiters.findIndex((waiter) => waiter.id === record.call.id)
    const index = exact >= 0 ? exact : waiters.findIndex((waiter) => waiter.id === undefined)
    if (index < 0) {
      record.claimed = false
      return
    }
    const [waiter] = waiters.splice(index, 1)
    if (waiter === undefined) throw new Error(`missing ${name} tool call waiter`)
    record.claimed = true
    waiter.delivered = record
    waiter.resume(Effect.succeed(record.call))
  }

  const offer = (record: Active) =>
    Effect.suspend(() => {
      const id = record.call.id
      if (closed)
        return Effect.fail(
          new Failure({
            message: controlError("take", "controller-closed", name, id).message,
          }),
        )
      if (records.has(id))
        return Effect.fail(
          new Failure({
            message: `duplicate ${name} tool call ID: ${id}`,
          }),
        )
      records.set(id, record)
      deliver(record)
      return Effect.void
    })

  function take(): Effect.Effect<Call, ControlError>
  function take(id: string): Effect.Effect<Call, ControlError>
  function take(id?: string): Effect.Effect<Call, ControlError> {
    return Effect.callback<Call, ControlError>((resume) => {
      if (closed) {
        resume(Effect.fail(controlError("take", "controller-closed", name, id)))
        return undefined
      }
      if (id !== undefined && (records.get(id)?.claimed === true || waiters.some((waiter) => waiter.id === id))) {
        resume(Effect.fail(controlError("take", "already-claimed", name, id)))
        return undefined
      }
      let record = id === undefined ? undefined : records.get(id)
      if (id === undefined) {
        for (const candidate of records.values()) {
          if (candidate.claimed) continue
          record = candidate
          break
        }
      }
      if (record !== undefined) {
        record.claimed = true
        resume(Effect.succeed(record.call))
        return Effect.sync(() => {
          if (!closed && records.get(record.call.id) === record) {
            record.claimed = false
            deliver(record)
          }
          return undefined
        })
      }
      const waiter: Waiter = { id, resume }
      waiters.push(waiter)
      return Effect.sync(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) {
          waiters.splice(index, 1)
          return undefined
        }
        const delivered = waiter.delivered
        if (delivered !== undefined && !closed && records.get(delivered.call.id) === delivered) {
          delivered.claimed = false
          deliver(delivered)
        }
        return undefined
      })
    })
  }

  const handler: Handler<Input, Output> = (context) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const result = Deferred.makeUnsafe<Output, Failure>()
        const interrupted = Deferred.makeUnsafe<void>()
        const operations = Semaphore.makeUnsafe(1)
        let state: "pending" | "settled" | Interruption = "pending"
        const unavailable = (operation: ControlError["operation"]) => {
          if (state === "pending") return undefined
          return controlError(operation, state === "settled" ? "already-settled" : state, name, context.id)
        }
        const commit = (operation: "succeed" | "fail", completion: Effect.Effect<Output, Failure>) =>
          // Accepted progress must finish before the one terminal commitment.
          operations.withPermit(
            Effect.suspend(() => {
              const failure = unavailable(operation)
              if (failure !== undefined) return Effect.fail(failure)
              return Effect.sync(() => {
                state = "settled"
                return Deferred.doneUnsafe(result, completion)
                  ? undefined
                  : controlError(operation, "already-settled", name, context.id)
              }).pipe(Effect.flatMap((failure) => (failure === undefined ? Effect.void : Effect.fail(failure))))
            }),
          )
        const call: Call = {
          id: context.id,
          input: context.input,
          index: context.index,
          progress: (output) =>
            operations.withPermit(
              Effect.suspend(() => {
                const failure = unavailable("progress")
                return failure === undefined ? context.progress(output) : Effect.fail(failure)
              }),
            ),
          succeed: (output) => commit("succeed", Effect.succeed(output)),
          fail: (message) => commit("fail", Effect.fail(new Failure({ message }))),
          awaitInterrupted: () => Deferred.await(interrupted),
        }
        const record: Active = {
          call,
          claimed: false,
          interrupt: (reason) => {
            if (state !== "pending") return
            state = reason
            Deferred.doneUnsafe(interrupted, Effect.void)
            Deferred.doneUnsafe(result, Effect.interrupt)
          },
        }
        return yield* offer(record).pipe(
          Effect.andThen(restore(Deferred.await(result))),
          Effect.onInterrupt(() => Effect.sync(() => record.interrupt("transport-interrupted"))),
          Effect.ensuring(
            Effect.sync(() => {
              if (records.get(context.id) === record) records.delete(context.id)
            }),
          ),
        )
      }),
    )

  const close = Effect.sync(() => {
    if (closed) return
    closed = true
    for (const waiter of waiters) waiter.resume(Effect.fail(controlError("take", "controller-closed", name, waiter.id)))
    waiters.length = 0
    for (const record of records.values()) record.interrupt("controller-closed")
  })

  return { calls: { take }, handler, close }
}

function execute(
  request: Request,
  name: string,
  definition: Definition,
  indexes: Map<string, number>,
  active: Map<AbortController, Promise<unknown>>,
  background: Map<string, BackgroundJob>,
) {
  const transport = new TransformStream<Uint8Array, Uint8Array>()
  const writer = transport.writable.getWriter()
  const controller = new AbortController()
  const signal = AbortSignal.any([request.signal, controller.signal])
  const send = (event: Event) =>
    Effect.suspend(() => {
      const frame = encodeEvent(event)
      return Effect.promise(() => writer.write(frame))
    })
  let launched: BackgroundJob | undefined
  const result = Effect.gen(function* () {
    const body = yield* Schema.decodeUnknownEffect(ExecutionRequest)(yield* Effect.promise(() => request.json()))
    const input = body.input
    if (name === "shell" && isBackgroundShell(input)) {
      const shellID = body.context.callID
      if (shellID.length === 0) return yield* Effect.die(new Error("Background shell requires a tool call ID"))
      const key = JSON.stringify(input)
      const existing = background.get(shellID)
      if (existing !== undefined) {
        if (existing.input !== key)
          return yield* Effect.die(new Error(`Background shell ID reused with different input: ${shellID}`))
        return {
          output: "The command was moved to the background.",
          shellID,
          status: "running" as const,
        }
      }
      const index = nextIndex(indexes, name)
      const job = startBackgroundShell(definition, input, index, shellID, key, active)
      background.set(shellID, job)
      launched = job
      return {
        output: "The command was moved to the background.",
        shellID,
        status: "running" as const,
      }
    }
    const index = nextIndex(indexes, name)
    return yield* definition.invoke(input, index, body.context.callID, (value) =>
      send({ type: "progress", result: value }),
    )
  })
  void writer.closed.catch((cause) => controller.abort(cause))
  const completion = (async () => {
    try {
      const exit = await Effect.runPromiseExit(result, { signal })
      if (signal.aborted) throw signal.reason ?? new Error("Drive tool execution interrupted")
      if (Exit.isSuccess(exit)) await Effect.runPromise(send({ type: "success", result: exit.value }), { signal })
      else {
        await Effect.runPromise(
          send({
            type: "failure",
            message: causeMessage(exit.cause),
          }),
          { signal },
        )
      }
      await writer.close()
    } catch {
      if (launched !== undefined) launched.cancel()
      await writer.abort().catch(() => undefined)
    } finally {
      active.delete(controller)
    }
  })()
  active.set(controller, completion)
  return new Response(transport.readable, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function isBackgroundShell(input: unknown): input is { readonly command: string; readonly background: true } {
  return (
    typeof input === "object" &&
    input !== null &&
    "background" in input &&
    input.background === true &&
    "command" in input &&
    typeof input.command === "string"
  )
}

function startBackgroundShell(
  definition: Definition,
  input: { readonly command: string; readonly background: true },
  index: number,
  shellID: string,
  inputKey: string,
  active: Map<AbortController, Promise<unknown>>,
): BackgroundJob {
  const controller = new AbortController()
  let output = ""
  const result = definition.invoke(input, index, shellID, (value) =>
    Effect.sync(() => {
      encodeEvent({ type: "progress", result: value })
      output = value.output
    }),
  )
  const completion = Effect.runPromiseExit(result, { signal: controller.signal })
    .then((exit): BackgroundCompletion => {
      if (Exit.isSuccess(exit)) {
        encodeEvent({ type: "success", result: exit.value })
        return { shellID, command: input.command, state: "completed", output: exit.value.output }
      }
      if (controller.signal.aborted)
        return { shellID, command: input.command, state: "cancelled", output: output || "Command cancelled" }
      const message = causeMessage(exit.cause)
      return {
        shellID,
        command: input.command,
        state: "error",
        output: errorOutput(output, message),
      }
    })
    .catch(
      (cause): BackgroundCompletion => ({
        shellID,
        command: input.command,
        state: controller.signal.aborted ? "cancelled" : "error",
        output: errorOutput(output, cause instanceof Error ? cause.message : String(cause)),
      }),
    )
    .finally(() => active.delete(controller))
  active.set(controller, completion)
  return {
    input: inputKey,
    completion,
    cancel: () => controller.abort(new Error("Background shell launch disconnected")),
  }
}

function nextIndex(indexes: Map<string, number>, name: string): number {
  const index = indexes.get(name) ?? 0
  indexes.set(name, index + 1)
  return index
}

function encodeEvent(event: Event): Uint8Array {
  const frame = encoder.encode(`${JSON.stringify(event)}\n`)
  if (frame.byteLength > MAX_EVENT_BYTES) throw new Error(`Drive tool event exceeds ${MAX_EVENT_BYTES} bytes`)
  return frame
}

function boundedOutput(output: string): string {
  const bytes = Buffer.from(output)
  return bytes.byteLength <= MAX_EVENT_BYTES ? output : bytes.subarray(0, MAX_EVENT_BYTES).toString("utf8")
}

function errorOutput(output: string, message: string): string {
  if (!output) return boundedOutput(message)
  const suffix = `\n${message}`
  const suffixBytes = Buffer.from(suffix)
  if (suffixBytes.byteLength >= MAX_EVENT_BYTES) return boundedOutput(message)
  const prefix = Buffer.from(output.replace(/\n$/, ""))
    .subarray(0, MAX_EVENT_BYTES - suffixBytes.byteLength)
    .toString("utf8")
  return `${prefix}${suffix}`
}

function causeMessage(cause: Cause.Cause<unknown>): string {
  const failure = Cause.findErrorOption(cause)
  const error = Option.isSome(failure) ? failure.value : Cause.squash(cause)
  return error instanceof Failure ? error.message : error instanceof Error ? error.message : String(error)
}
