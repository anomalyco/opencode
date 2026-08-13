export * as PersistentPty from "./index.js"

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { setTimeout } from "node:timers/promises"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Group } from "./group.js"
import { Database } from "../database/database.js"
import { Pty } from "@opencode-ai/schema/pty"

const ProtocolVersion = 1
const MaxFrameBytes = 8 * 1024 * 1024

const Lifecycle = Schema.Union([
  Schema.Struct({ status: Schema.Literal("running") }),
  Schema.Struct({ status: Schema.Literal("exited"), exit_code: Schema.NullOr(Schema.Number) }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
])

const WireTerminal = Schema.Struct({
  id: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  title: Schema.String,
  group_id: Schema.String,
  command: Schema.Array(Schema.String),
  cwd: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
  lifecycle: Lifecycle,
  output_head: Schema.Number,
  output_tail: Schema.Number,
})

const Registration = Schema.Struct({
  instance_id: Schema.String,
  pid: Schema.Number,
  protocol: Schema.Number,
  socket: Schema.String,
  token: Schema.String,
})

const Response = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pong"),
    instance_id: Schema.String,
    pid: Schema.Number,
    protocol: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("created"), terminal: WireTerminal }),
  Schema.Struct({ type: Schema.Literal("terminals"), terminals: Schema.Array(WireTerminal) }),
  Schema.Struct({ type: Schema.Literal("ok") }),
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
    type: Schema.Literal("output"),
    start: Schema.Number,
    end: Schema.Number,
    data_base64: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("resized"),
    cols: Schema.Number,
    rows: Schema.Number,
    generation: Schema.Number,
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
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
])

type WireTerminal = typeof WireTerminal.Type
type WireResponse = typeof Response.Type
type Registration = typeof Registration.Type

export type Role = "controller" | "observer"

export type Info = Pty.Info & {
  readonly groupID: Group.ID
  readonly output: { readonly head: number; readonly tail: number }
}

export type Snapshot = {
  readonly info: Info
  readonly text: string
  readonly checkpoint: Uint8Array
  readonly cursor: { readonly x: number; readonly y: number }
}

export type StreamEvent =
  | { readonly type: "output"; readonly start: number; readonly end: number; readonly data: Uint8Array }
  | { readonly type: "resized"; readonly cols: number; readonly rows: number; readonly generation: number }
  | { readonly type: "exited"; readonly exitCode?: number; readonly finalOffset: number }
  | { readonly type: "controller_changed"; readonly attachmentID?: string; readonly generation: number }

export type Attachment = {
  readonly info: Info
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

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("PersistentPty.UnavailableError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PersistentPty.NotFoundError", {
  ptyID: Pty.ID,
}) {}

export class GroupNotFoundError extends Schema.TaggedErrorClass<GroupNotFoundError>()(
  "PersistentPty.GroupNotFoundError",
  { groupID: Group.ID },
) {}

export interface Interface {
  readonly list: (groupID?: Group.ID) => Effect.Effect<Info[], UnavailableError>
  readonly get: (id: Pty.ID) => Effect.Effect<Info, NotFoundError | UnavailableError>
  readonly create: (
    groupID: Group.ID,
    input: {
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
      readonly title: string
      readonly env: Readonly<Record<string, string>>
      readonly cols?: number
      readonly rows?: number
    },
  ) => Effect.Effect<Info, GroupNotFoundError | UnavailableError>
  readonly write: (
    id: Pty.ID,
    data: string,
    attachmentID?: string,
  ) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly resize: (
    id: Pty.ID,
    cols: number,
    rows: number,
    attachmentID?: string,
  ) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly snapshot: (id: Pty.ID) => Effect.Effect<Snapshot, NotFoundError | UnavailableError>
  readonly remove: (id: Pty.ID) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly attach: (
    id: Pty.ID,
    input: {
      readonly cursor: number
      readonly attachmentID: string
      readonly role: Role
      readonly takeover?: boolean
      readonly onEvent: (event: StreamEvent) => void
      readonly onEnd: () => void
    },
  ) => Effect.Effect<Attachment, NotFoundError | UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PersistentPty") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const groups = yield* Group.Service
    const database = yield* Database.Service
    const client = new Client(runtimeDirectory(databasePath(database.db)))

    const list = Effect.fn("PersistentPty.list")(function* (groupID?: Group.ID) {
      const response = yield* optionalRequest(client, { op: "list" })
      if (!response) return []
      if (response.type !== "terminals") return yield* unexpected(response)
      return response.terminals
        .map(toInfo)
        .filter((terminal) => groupID === undefined || terminal.groupID === groupID)
    })

    const get = Effect.fn("PersistentPty.get")(function* (id: Pty.ID) {
      const found = (yield* list()).find((terminal) => terminal.id === id)
      if (!found) return yield* new NotFoundError({ ptyID: id })
      return found
    })

    const create = Effect.fn("PersistentPty.create")(function* (
      groupID: Group.ID,
      input: {
        readonly command: string
        readonly args: readonly string[]
        readonly cwd: string
        readonly title: string
        readonly env: Readonly<Record<string, string>>
        readonly cols?: number
        readonly rows?: number
      },
    ) {
      const group = yield* groups.get(groupID)
      if (!group) return yield* new GroupNotFoundError({ groupID })
      const response = yield* request(client, {
        op: "create",
        program: input.command,
        args: input.args,
        cwd: input.cwd,
        title: input.title,
        group_id: groupID,
        env: input.env,
        cols: input.cols ?? 80,
        rows: input.rows ?? 24,
      }, true)
      if (response.type !== "created") return yield* unexpected(response)
      const terminal = toInfo(response.terminal)
      yield* groups.set(
        Group.Info.make({
          id: group.id,
          items: group.items.concat({ type: "terminal", id: terminal.id }),
        }),
      )
      return terminal
    })

    const write = Effect.fn("PersistentPty.write")(function* (
      id: Pty.ID,
      data: string,
      attachmentID?: string,
    ) {
      yield* get(id)
      const response = yield* request(client, {
        op: "write",
        id: fromID(id),
        attachment_id: attachmentID ?? null,
        data_base64: Buffer.from(data).toString("base64"),
      })
      if (response.type !== "ok") return yield* unexpected(response)
      return undefined
    })

    const resize = Effect.fn("PersistentPty.resize")(function* (
      id: Pty.ID,
      cols: number,
      rows: number,
      attachmentID?: string,
    ) {
      yield* get(id)
      const response = yield* request(client, {
        op: "resize",
        id: fromID(id),
        attachment_id: attachmentID ?? null,
        cols,
        rows,
      })
      if (response.type !== "ok") return yield* unexpected(response)
      return undefined
    })

    const snapshot = Effect.fn("PersistentPty.snapshot")(function* (id: Pty.ID) {
      yield* get(id)
      const response = yield* request(client, { op: "snapshot", id: fromID(id) })
      if (response.type !== "snapshot") return yield* unexpected(response)
      return {
        info: toInfo(response.terminal),
        text: response.text,
        checkpoint: Buffer.from(response.checkpoint_base64, "base64"),
        cursor: { x: response.cursor_x, y: response.cursor_y },
      }
    })

    const remove = Effect.fn("PersistentPty.remove")(function* (id: Pty.ID) {
      const terminal = yield* get(id)
      const response = yield* request(client, { op: "terminate", id: fromID(id) })
      if (response.type !== "ok") return yield* unexpected(response)
      const group = yield* groups.get(terminal.groupID)
      if (!group) return undefined
      yield* groups.set(
        Group.Info.make({
          id: group.id,
          items: group.items.filter((item) => item.type !== "terminal" || item.id !== id),
        }),
      )
      return undefined
    })

    const attach = Effect.fn("PersistentPty.attach")(function* (
      id: Pty.ID,
      input: {
        readonly cursor: number
        readonly attachmentID: string
        readonly role: Role
        readonly takeover?: boolean
        readonly onEvent: (event: StreamEvent) => void
        readonly onEnd: () => void
      },
    ) {
      yield* get(id)
      return yield* Effect.tryPromise({
        try: () => client.subscribe(fromID(id), input),
        catch: (error) => unavailable(error),
      })
    })

    return Service.of({ list, get, create, write, resize, snapshot, remove, attach })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Group.node, Database.node] })

class Client {
  private registration?: Promise<Registration>

  constructor(private readonly directory: string) {}

  request(value: object, start = false) {
    return this.connect(start).then((registration) => oneShot(registration, value))
  }

  requestIfRunning(value: object) {
    return this.request(value).catch(() => undefined)
  }

  async subscribe(
    id: number,
    input: {
      readonly cursor: number
      readonly attachmentID: string
      readonly role: Role
      readonly takeover?: boolean
      readonly onEvent: (event: StreamEvent) => void
      readonly onEnd: () => void
    },
  ): Promise<Attachment> {
    const registration = await this.connect(false)
    const socket = net.createConnection(registration.socket)
    const frames = decoder(socket)
    await connected(socket)
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
    if (response.type === "error") throw new Error(response.message)
    if (response.type !== "attached") throw new Error(`unexpected opencode-pty response: ${response.type}`)
    let detached = false
    const pump = async () => {
      try {
        for await (const frame of frames) {
          const event = decode(frame)
          if (event.type === "output")
            input.onEvent({
              type: "output",
              start: event.start,
              end: event.end,
              data: Buffer.from(event.data_base64, "base64"),
            })
          if (event.type === "resized")
            input.onEvent({
              type: "resized",
              cols: event.cols,
              rows: event.rows,
              generation: event.generation,
            })
          if (event.type === "controller_changed")
            input.onEvent({
              type: "controller_changed",
              attachmentID: event.attachment_id ?? undefined,
              generation: event.generation,
            })
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
      info: toInfo(response.terminal),
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
  }

  private connect(start: boolean) {
    this.registration ??= start ? ensure(this.directory) : discover(this.directory)
    return this.registration.catch((error) => {
      this.registration = undefined
      throw error
    })
  }
}

const request = (client: Client, value: object, start = false) =>
  Effect.tryPromise({ try: () => client.request(value, start), catch: (error) => unavailable(error) })

const optionalRequest = (client: Client, value: object) =>
  Effect.promise(() => client.requestIfRunning(value))

const unexpected = (response: WireResponse) =>
  Effect.fail(new UnavailableError({ message: `unexpected opencode-pty response: ${response.type}` }))

const unavailable = (error: unknown) =>
  new UnavailableError({ message: error instanceof Error ? error.message : String(error) })

function databasePath(db: Database.Interface["db"]) {
  const client: unknown = db.$client
  if ((typeof client !== "object" && typeof client !== "function") || client === null || !("config" in client))
    return undefined
  const config = client.config
  if (typeof config !== "object" || config === null || !("filename" in config)) return undefined
  if (typeof config.filename !== "string" || config.filename === ":memory:") return undefined
  return path.resolve(config.filename)
}

const runtimeDirectory = (databasePath?: string) => {
  const root =
    process.env.OPENCODE_PTY_RUNTIME_DIR ??
    (process.env.XDG_RUNTIME_DIR
      ? path.join(process.env.XDG_RUNTIME_DIR, "opencode-pty")
      : path.join(
          os.tmpdir(),
          `opencode-pty-${typeof process.getuid === "function" ? process.getuid() : process.env.USER || "unknown"}`,
        ))
  const identity = databasePath ?? `memory:${crypto.randomUUID()}`
  return path.join(root, createHash("sha256").update(identity).digest("hex").slice(0, 16))
}

const registrationPath = (directory: string) => path.join(directory, "service.json")

async function ensure(directory: string) {
  const found = await discover(directory).catch(() => undefined)
  if (found) return found
  spawn(process.env.OPENCODE_PTY_BIN || "opencode-pty", ["daemon"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, OPENCODE_PTY_RUNTIME_DIR: directory },
  }).unref()
  const deadline = Date.now() + 5_000
  let last: unknown
  while (Date.now() < deadline) {
    try {
      return await discover(directory)
    } catch (error) {
      last = error
      await setTimeout(50)
    }
  }
  throw last instanceof Error ? last : new Error("opencode-pty did not become ready")
}

async function discover(directory: string) {
  const registration = Schema.decodeUnknownSync(Registration)(
    JSON.parse(await readFile(registrationPath(directory), "utf8")),
  )
  if (registration.protocol !== ProtocolVersion) throw new Error("opencode-pty protocol mismatch")
  const response = await oneShot(registration, { op: "ping" })
  if (
    response.type !== "pong" ||
    response.instance_id !== registration.instance_id ||
    response.pid !== registration.pid ||
    response.protocol !== ProtocolVersion
  )
    throw new Error("opencode-pty registration mismatch")
  return registration
}

async function oneShot(registration: Registration, request: object) {
  const socket = net.createConnection(registration.socket)
  const frames = decoder(socket)
  await connected(socket)
  socket.write(encode({ token: registration.token, request }))
  const first = await frames.next()
  socket.end()
  if (first.done) throw new Error("opencode-pty closed without response")
  const response = decode(first.value)
  if (response.type === "error") throw new Error(response.message)
  return response
}

function connected(socket: net.Socket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
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
  return Schema.decodeUnknownSync(Response)(JSON.parse(Buffer.from(payload).toString("utf8")))
}

function toInfo(value: WireTerminal): Info {
  const status = value.lifecycle.status
  return {
    ...Pty.Info.make({
      id: toID(value.id),
      title: value.title,
      command: value.command[0] || "",
      args: value.command.slice(1),
      cwd: value.cwd,
      status: status === "running" ? "running" : "exited",
      pid: value.pid ?? 0,
      ...(status === "exited" ? { exitCode: value.lifecycle.exit_code ?? undefined } : {}),
    }),
    groupID: Group.ID.make(value.group_id),
    output: { head: value.output_head, tail: value.output_tail },
  }
}

function toID(value: number) {
  return Pty.ID.make(`pty_persistent_${value}`)
}

function fromID(value: Pty.ID) {
  if (!value.startsWith("pty_persistent_")) throw new Error(`invalid persistent PTY ID: ${value}`)
  const parsed = Number(value.slice("pty_persistent_".length))
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`invalid persistent PTY ID: ${value}`)
  return parsed
}
