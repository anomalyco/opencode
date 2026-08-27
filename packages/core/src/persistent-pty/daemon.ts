import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { Data, Duration, Effect, Schema, Semaphore } from "effect"
import type { Handoff } from "@opencode-ai/schema/persistent-pty"

const ProtocolVersion = 7
const MaxFrameBytes = 8 * 1024 * 1024

const Lifecycle = Schema.Union([
  Schema.Struct({ status: Schema.Literal("running") }),
  Schema.Struct({ status: Schema.Literal("exited"), exit_code: Schema.NullOr(Schema.Number) }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
])

export const WireTerminal = Schema.Struct({
  id: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  title: Schema.String,
  foreground_process: Schema.NullOr(Schema.String),
  group_id: Schema.String,
  command: Schema.Array(Schema.String),
  cwd: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
  lifecycle: Lifecycle,
  output_head: Schema.Number,
  output_tail: Schema.Number,
})
export type WireTerminal = typeof WireTerminal.Type

const Registration = Schema.Struct({
  instance_id: Schema.String,
  pid: Schema.Number,
  protocol: Schema.Number,
  socket: Schema.String,
  token: Schema.String,
})
type Registration = typeof Registration.Type

export const WireResponse = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pong"),
    instance_id: Schema.String,
    pid: Schema.Number,
    protocol: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("created"), terminal: WireTerminal }),
  Schema.Struct({ type: Schema.Literal("terminals"), terminals: Schema.Array(WireTerminal) }),
  Schema.Struct({ type: Schema.Literal("ok") }),
  Schema.Struct({ type: Schema.Literal("owned") }),
  Schema.Struct({ type: Schema.Literal("handoff"), ticket: Schema.String, expires_at: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    terminal: WireTerminal,
    text: Schema.String,
    checkpoint_base64: Schema.String,
    cursor_x: Schema.Number,
    cursor_y: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("attached"),
    terminal: WireTerminal,
    role: Schema.Literals(["controller", "observer"]),
    generation: Schema.Number,
    requested_offset: Schema.Number,
    available_offset: Schema.Number,
    end_offset: Schema.Number,
    truncated: Schema.Boolean,
    replay_base64: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("resized"),
    cols: Schema.Number,
    rows: Schema.Number,
    generation: Schema.Number,
    checkpoint_base64: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("exited"),
    exit_code: Schema.NullOr(Schema.Number),
    final_offset: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("controller_changed"),
    attachment_id: Schema.NullOr(Schema.String),
    generation: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("title_changed"), title: Schema.String }),
  Schema.Struct({ type: Schema.Literal("foreground_process_changed"), process: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
])
export type WireResponse = typeof WireResponse.Type

export type Role = "controller" | "observer"

export type StreamEvent =
  | { readonly type: "output"; readonly start: number; readonly end: number; readonly data: Uint8Array }
  | {
      readonly type: "resized"
      readonly cols: number
      readonly rows: number
      readonly generation: number
      readonly checkpoint: Uint8Array
    }
  | { readonly type: "exited"; readonly exitCode?: number; readonly finalOffset: number }
  | { readonly type: "controller_changed"; readonly attachmentID?: string; readonly generation: number }
  | { readonly type: "title_changed"; readonly title: string }
  | { readonly type: "foreground_process_changed"; readonly process: string | null }

export type DaemonAttachment = {
  readonly terminal: WireTerminal
  readonly role: Role
  readonly generation: number
  readonly replay: {
    readonly requestedOffset: number
    readonly availableOffset: number
    readonly endOffset: number
    readonly truncated: boolean
    readonly data: Uint8Array
  }
  readonly activate: () => void
  readonly detach: () => void
}

export class DaemonError extends Data.TaggedError("PersistentPty.DaemonError")<{
  readonly kind: "connect" | "response" | "registration" | "protocol" | "spawn"
  readonly message: string
  readonly pid?: number
}> {}

export interface DaemonTransport {
  readonly request: (value: object, start?: boolean) => Effect.Effect<WireResponse, DaemonError>
  readonly requestIfRunning: (value: object) => Effect.Effect<WireResponse | undefined, DaemonError>
  readonly shutdown: Effect.Effect<WireResponse | undefined, DaemonError>
  readonly handoff: Effect.Effect<Handoff | null, DaemonError>
  readonly subscribe: (
    id: number,
    input: {
      readonly cursor: number
      readonly attachmentID: string
      readonly role: Role
      readonly takeover?: boolean
      readonly onEvent: (event: StreamEvent) => void
      readonly onEnd: () => void
    },
  ) => Effect.Effect<DaemonAttachment, DaemonError>
}

export const makeDaemonTransport = Effect.fn("PersistentPty.makeDaemonTransport")(function* (
  directory: string,
  binary: () => Promise<string> = () => Promise.resolve(process.env.OPENCODE_PTY_BIN || "opencode-pty"),
  inherited?: Handoff,
) {
  const startup = Semaphore.makeUnsafe(1)
  let registration: Registration | undefined
  let owner: Awaited<ReturnType<typeof openOwner>> | undefined
  let closed = false
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true
      owner?.socket.destroy()
    }),
  )

  const claim = (current: Registration, ticket?: string) =>
    Effect.tryPromise({
      try: async (signal) => {
        const connection = await openOwner(current, ticket, signal)
        if (closed || signal.aborted) {
          connection.socket.destroy()
          throw new Error("PTY owner scope is closed")
        }
        owner = connection
        registration = current
        connection.socket.once("close", () => {
          if (owner !== connection) return
          owner = undefined
          registration = undefined
        })
      },
      catch: (cause) => failure("connect", cause),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(5),
        orElse: () => Effect.fail(new DaemonError({ kind: "connect", message: "PTY ownership claim timed out" })),
      }),
    )

  const discover = Effect.fn("PersistentPty.daemon.discover")(function* () {
    const value = yield* Effect.tryPromise({
      try: () => readFile(path.join(directory, "service.json"), "utf8"),
      catch: (cause) => failure("connect", cause),
    })
    const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Registration))(value).pipe(
      Effect.mapError((cause) => failure("protocol", cause)),
    )
    if (decoded.protocol !== ProtocolVersion)
      return yield* Effect.fail(
        new DaemonError({
          kind: "protocol",
          message: `opencode-pty protocol mismatch: daemon=${decoded.protocol}, client=${ProtocolVersion}`,
          pid: decoded.pid,
        }),
      )
    const response = yield* oneShot(decoded, { op: "ping" })
    if (
      response.type !== "pong" ||
      response.instance_id !== decoded.instance_id ||
      response.pid !== decoded.pid ||
      response.protocol !== ProtocolVersion
    )
      return yield* Effect.fail(new DaemonError({ kind: "protocol", message: "opencode-pty registration mismatch" }))
    return decoded
  })

  const start = Effect.fn("PersistentPty.daemon.start")(function* () {
    const executable = yield* Effect.tryPromise({ try: binary, catch: (cause) => failure("spawn", cause) })
    const child = yield* Effect.tryPromise({
      try: () =>
        new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
          const child = spawn(executable, ["daemon"], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env, OPENCODE_PTY_RUNTIME_DIR: directory },
          })
          child.once("spawn", () => {
            child.unref()
            resolve(child)
          })
          child.once("error", reject)
        }),
      catch: (cause) => failure("spawn", cause),
    })
    return yield* Effect.gen(function* () {
      const deadline = Date.now() + 5_000
      let last: DaemonError | undefined
      while (Date.now() < deadline) {
        const found = yield* discover().pipe(
          Effect.map((value) => ({ value })),
          Effect.catch((error) => {
            last = error
            return Effect.succeed(undefined)
          }),
        )
        if (found) {
          yield* claim(found.value)
          return found.value
        }
        yield* Effect.sleep(50)
      }
      return yield* Effect.fail(
        last ?? new DaemonError({ kind: "connect", message: "opencode-pty did not become ready" }),
      )
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          child.kill("SIGTERM")
        }),
      ),
    )
  })

  const connect = Effect.fn("PersistentPty.daemon.connect")(function* (shouldStart: boolean) {
    if (closed) return yield* Effect.fail(new DaemonError({ kind: "connect", message: "PTY owner scope is closed" }))
    if (registration) return registration
    return yield* startup.withPermit(
      Effect.gen(function* () {
        if (registration) return registration
        const found = yield* discover().pipe(
          Effect.catch((error) => {
            if (shouldStart && error.kind === "connect") return start()
            return Effect.fail(error)
          }),
        )
        if (!owner) yield* claim(found)
        registration = found
        return found
      }),
    )
  })

  const attempt = Effect.fn("PersistentPty.daemon.request-attempt")(function* (value: object, shouldStart: boolean) {
    const current = yield* connect(shouldStart)
    return yield* oneShot(current, value).pipe(
      Effect.catch((error) => {
        if (error.kind === "registration" && registration === current) registration = undefined
        return Effect.fail(error)
      }),
    )
  })

  const request = Effect.fn("PersistentPty.daemon.request")(function* (value: object, shouldStart = false) {
    return yield* attempt(value, shouldStart).pipe(
      Effect.catch((error) => {
        if (error.kind === "registration") return attempt(value, shouldStart)
        if (error.kind !== "connect") return Effect.fail(error)
        registration = undefined
        if (!shouldStart) return Effect.fail(error)
        return attempt(value, true)
      }),
    )
  })

  const requestIfRunning = (value: object) =>
    request(value).pipe(
      Effect.catch((error) => (error.kind === "connect" ? Effect.succeed(undefined) : Effect.fail(error))),
    )

  const shutdown = Effect.gen(function* () {
    const response = yield* requestIfRunning({ op: "shutdown" })
    registration = undefined
    if (!response) return undefined
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const running = yield* discover().pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!running) return response
      yield* Effect.sleep(50)
    }
    return yield* Effect.fail(new DaemonError({ kind: "connect", message: "opencode-pty did not stop" }))
  })

  const handoff = startup.withPermit(
    Effect.gen(function* () {
      const current = owner
      const registered = registration
      if (!current || !registered) return null
      const response = yield* Effect.tryPromise({
        try: (signal) => current.exchange({ op: "prepare_handoff" }, signal),
        catch: (cause) => failure("response", cause),
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(5),
          orElse: () =>
            Effect.fail(new DaemonError({ kind: "response", message: "PTY handoff preparation timed out" })),
        }),
      )
      if (response.type !== "handoff")
        return yield* Effect.fail(new DaemonError({ kind: "protocol", message: "Expected PTY handoff ticket" }))
      return { directory, instanceID: registered.instance_id, ticket: response.ticket, expiresAt: response.expires_at }
    }),
  )

  const subscribe = Effect.fn("PersistentPty.daemon.subscribe")(function* (
    id: number,
    input: Parameters<DaemonTransport["subscribe"]>[1],
  ) {
    const attempt = Effect.gen(function* () {
      const current = yield* connect(false)
      return yield* Effect.tryPromise({
        try: () => subscribePromise(current, id, input),
        catch: (cause) => (cause instanceof DaemonError ? cause : failure("connect", cause)),
      }).pipe(
        Effect.catch((error) => {
          if (error.kind === "registration" && registration === current) registration = undefined
          return Effect.fail(error)
        }),
      )
    })
    return yield* attempt.pipe(Effect.catch((error) => (error.kind === "registration" ? attempt : Effect.fail(error))))
  })

  // A replacement must own its inherited daemon before the server becomes ready.
  if (inherited) {
    if (inherited.expiresAt <= Date.now())
      return yield* Effect.fail(new DaemonError({ kind: "registration", message: "PTY restart handoff expired" }))
    const current = yield* discover()
    if (current.instance_id !== inherited.instanceID)
      return yield* Effect.fail(new DaemonError({ kind: "registration", message: "PTY restart daemon changed" }))
    yield* claim(current, inherited.ticket)
  }

  return { request, requestIfRunning, shutdown, handoff, subscribe } satisfies DaemonTransport
})

async function openOwner(registration: Registration, ticket: string | undefined, signal: AbortSignal) {
  const socket = net.createConnection({ path: registration.socket })
  const frames = decoder(socket)
  const abort = () => socket.destroy()
  signal.addEventListener("abort", abort, { once: true })
  const exchange = async (request: object, signal: AbortSignal) => {
    if (signal.aborted) throw new Error("PTY ownership request interrupted")
    signal.addEventListener("abort", abort, { once: true })
    try {
      socket.write(encode({ token: registration.token, request }))
      const frame = await frames.next()
      if (frame.done) throw new Error("PTY daemon closed its ownership connection")
      const response = decode(frame.value)
      if (response.type === "error") throw new Error(response.message)
      return response
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
      socket.once("close", () => reject(new Error("PTY ownership connection closed")))
    })
    const response = await exchange({ op: "own", instance_id: registration.instance_id, ticket }, signal)
    if (response.type !== "owned") throw new Error("PTY daemon does not support server ownership")
    socket.unref()
    return { socket, exchange }
  } catch (error) {
    socket.destroy()
    throw error
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

const oneShot = Effect.fn("PersistentPty.daemon.oneShot")(function* (registration: Registration, request: object) {
  const payload = yield* Effect.try({
    try: () => encode({ token: registration.token, request }),
    catch: (cause) => failure("protocol", cause),
  })
  let dispatched = false
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: (signal) =>
        new Promise<net.Socket>((resolve, reject) => {
          const socket = net.createConnection({ path: registration.socket, signal })
          socket.once("connect", () => resolve(socket))
          socket.once("error", reject)
        }),
      catch: (cause) => failure("connect", cause),
    }),
    (socket) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => {
            dispatched = true
            socket.write(payload)
          },
          catch: (cause) => failure("response", cause),
        })
        const first = yield* Effect.tryPromise({
          try: async (signal) => {
            const frames = decoder(socket)
            const abort = () => socket.destroy()
            signal.addEventListener("abort", abort, { once: true })
            try {
              const frame = await frames.next()
              if (frame.done) throw new Error("opencode-pty closed without response")
              return frame.value
            } finally {
              signal.removeEventListener("abort", abort)
            }
          },
          catch: (cause) => failure("response", cause),
        })
        const response = yield* Effect.try({
          try: () => decode(first),
          catch: (cause) => failure("protocol", cause),
        })
        if (response.type === "error")
          return yield* Effect.fail(
            new DaemonError({
              kind: response.message === "authentication failed" ? "registration" : "protocol",
              message: response.message,
            }),
          )
        return response
      }),
    (socket) => Effect.sync(() => socket.destroy()),
  ).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(5),
      orElse: () =>
        Effect.fail(
          new DaemonError({
            kind: dispatched ? "response" : "connect",
            message: "opencode-pty request timed out",
          }),
        ),
    }),
  )
})

async function subscribePromise(
  registration: Registration,
  id: number,
  input: Parameters<DaemonTransport["subscribe"]>[1],
): Promise<DaemonAttachment> {
  const socket = net.createConnection(registration.socket)
  const frames = decoder(socket)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })
    socket.write(
      encode({
        token: registration.token,
        request: {
          op: "subscribe",
          id,
          offset: input.cursor,
          attachment_id: input.attachmentID,
          role: input.role,
          takeover: input.takeover ?? false,
        },
      }),
    )
    const initial = await frames.next()
    if (initial.done) throw new Error("opencode-pty closed before attachment")
    const response = decode(initial.value)
    if (response.type === "error")
      throw new DaemonError({
        kind: response.message === "authentication failed" ? "registration" : "protocol",
        message: response.message,
      })
    if (response.type !== "attached") throw new Error(`unexpected opencode-pty response: ${response.type}`)
    let detached = false
    const pump = async () => {
      try {
        for await (const frame of frames) {
          if (frame[0] === 0) {
            if (frame.length < 17) throw new Error("invalid opencode-pty output frame")
            input.onEvent({
              type: "output",
              start: Number(frame.readBigUInt64BE(1)),
              end: Number(frame.readBigUInt64BE(9)),
              data: frame.subarray(17),
            })
            continue
          }
          const event = decode(frame)
          if (event.type === "resized")
            input.onEvent({
              type: "resized",
              cols: event.cols,
              rows: event.rows,
              generation: event.generation,
              checkpoint: Buffer.from(event.checkpoint_base64, "base64"),
            })
          if (event.type === "controller_changed")
            input.onEvent({
              type: "controller_changed",
              attachmentID: event.attachment_id ?? undefined,
              generation: event.generation,
            })
          if (event.type === "title_changed") input.onEvent({ type: "title_changed", title: event.title })
          if (event.type === "foreground_process_changed")
            input.onEvent({ type: "foreground_process_changed", process: event.process })
          if (event.type === "exited") {
            input.onEvent({
              type: "exited",
              exitCode: event.exit_code ?? undefined,
              finalOffset: event.final_offset,
            })
            return
          }
        }
      } finally {
        if (!detached) input.onEnd()
      }
    }
    let activated = false
    return {
      terminal: response.terminal,
      role: response.role,
      generation: response.generation,
      replay: {
        requestedOffset: response.requested_offset,
        availableOffset: response.available_offset,
        endOffset: response.end_offset,
        truncated: response.truncated,
        data: Buffer.from(response.replay_base64, "base64"),
      },
      activate() {
        if (activated || detached) return
        activated = true
        void pump().catch(() => {})
      },
      detach() {
        if (detached) return
        detached = true
        socket.destroy()
      },
    }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function encode(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value))
  if (payload.length > MaxFrameBytes) throw new Error("opencode-pty frame too large")
  const output = Buffer.allocUnsafe(payload.length + 4)
  output.writeUInt32BE(payload.length)
  payload.copy(output, 4)
  return output
}

async function* decoder(socket: net.Socket) {
  let pending = Buffer.alloc(0)
  for await (const value of socket) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0)
      if (length > MaxFrameBytes) throw new Error("opencode-pty frame too large")
      if (pending.length < length + 4) break
      yield pending.subarray(4, length + 4)
      pending = pending.subarray(length + 4)
    }
  }
  if (pending.length !== 0) throw new Error("opencode-pty truncated frame")
}

function decode(payload: Uint8Array) {
  return Schema.decodeUnknownSync(WireResponse)(JSON.parse(Buffer.from(payload).toString("utf8")))
}

function failure(kind: DaemonError["kind"], cause: unknown) {
  return new DaemonError({ kind, message: cause instanceof Error ? cause.message : String(cause) })
}
