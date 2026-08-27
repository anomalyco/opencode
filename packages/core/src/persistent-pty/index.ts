export * as PersistentPty from "./index.js"

import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Added, Removed } from "@opencode-ai/schema/persistent-pty"
import { Session } from "@opencode-ai/schema/session"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Pty } from "@opencode-ai/schema/pty"
import { Global } from "@opencode-ai/util/global"
import {
  makeDaemonTransport,
  type DaemonTransport,
  type Role,
  type StreamEvent,
  type WireResponse,
  type WireTerminal,
} from "./daemon.js"
import { resolveBinary } from "#persistent-pty-binary"

export type { Role, StreamEvent } from "./daemon.js"

export type Info = Pty.Info & {
  readonly sessionID: Session.ID
  readonly foregroundProcess: string | null
  readonly size: { readonly cols: number; readonly rows: number }
  readonly output: { readonly head: number; readonly tail: number }
}

export type Snapshot = {
  readonly info: Info
  readonly text: string
  readonly checkpoint: Uint8Array
  readonly cursor: { readonly x: number; readonly y: number }
}

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

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("PersistentPty.UnavailableError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PersistentPty.NotFoundError", {
  ptyID: Pty.ID,
}) {}

export interface Interface {
  readonly list: (sessionID?: Session.ID) => Effect.Effect<Info[], UnavailableError>
  readonly get: (id: Pty.ID) => Effect.Effect<Info, NotFoundError | UnavailableError>
  readonly create: (
    sessionID: Session.ID,
    input: {
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
      readonly title: string
      readonly env: Readonly<Record<string, string>>
      readonly cols?: number
      readonly rows?: number
    },
  ) => Effect.Effect<Info, UnavailableError>
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
  readonly control: (
    id: Pty.ID,
    attachmentID: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly input: (
    id: Pty.ID,
    attachmentID: string,
    cols: number,
    rows: number,
    data: Uint8Array,
  ) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly snapshot: (id: Pty.ID) => Effect.Effect<Snapshot, NotFoundError | UnavailableError>
  readonly remove: (id: Pty.ID) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly shutdown: () => Effect.Effect<void, UnavailableError>
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
    const bus = yield* Bus.Service
    const database = yield* Database.Service
    const global = yield* Global.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    let binary: Promise<string> | undefined
    const daemon = yield* makeDaemonTransport(
      runtimeDirectory(databasePath(database.db)),
      () =>
        (binary ??= resolveBinary(global.bin).catch((error) => {
          binary = undefined
          throw error
        })),
    )
    const removing = new Set<Pty.ID>()

    const list = Effect.fn("PersistentPty.list")(function* (sessionID?: Session.ID) {
      const response = yield* optionalRequest(daemon, { op: "list" })
      if (!response) return []
      if (response.type !== "terminals") return yield* unexpected(response)
      return response.terminals
        .map(toInfo)
        .filter((terminal) => sessionID === undefined || terminal.sessionID === sessionID)
    })

    const get = Effect.fn("PersistentPty.get")(function* (id: Pty.ID) {
      const found = (yield* list()).find((terminal) => terminal.id === id)
      if (!found) return yield* new NotFoundError({ ptyID: id })
      return found
    })

    const create = Effect.fn("PersistentPty.create")(function* (
      sessionID: Session.ID,
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
      const response = yield* request(
        daemon,
        {
          op: "create",
          program: input.command,
          args: input.args,
          cwd: input.cwd,
          title: input.title,
          group_id: sessionID,
          env: input.env,
          cols: input.cols ?? 80,
          rows: input.rows ?? 24,
        },
        true,
      )
      if (response.type !== "created") return yield* unexpected(response)
      const terminal = toInfo(response.terminal)
      yield* bus.publish(Added, { sessionID, terminal })
      return terminal
    })

    const write = Effect.fn("PersistentPty.write")(function* (id: Pty.ID, data: string, attachmentID?: string) {
      yield* get(id)
      const response = yield* request(daemon, {
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
      const response = yield* request(daemon, {
        op: "resize",
        id: fromID(id),
        attachment_id: attachmentID ?? null,
        cols,
        rows,
      })
      if (response.type !== "ok") return yield* unexpected(response)
      return undefined
    })

    const control = Effect.fn("PersistentPty.control")(function* (
      id: Pty.ID,
      attachmentID: string,
      cols: number,
      rows: number,
    ) {
      yield* get(id)
      const response = yield* request(daemon, {
        op: "control",
        id: fromID(id),
        attachment_id: attachmentID,
        cols,
        rows,
      })
      if (response.type !== "ok") return yield* unexpected(response)
      return undefined
    })

    const input = Effect.fn("PersistentPty.input")(function* (
      id: Pty.ID,
      attachmentID: string,
      cols: number,
      rows: number,
      data: Uint8Array,
    ) {
      yield* get(id)
      const response = yield* request(daemon, {
        op: "input",
        id: fromID(id),
        attachment_id: attachmentID,
        cols,
        rows,
        data_base64: Buffer.from(data).toString("base64"),
      })
      if (response.type !== "ok") return yield* unexpected(response)
      return undefined
    })

    const snapshot = Effect.fn("PersistentPty.snapshot")(function* (id: Pty.ID) {
      yield* get(id)
      const response = yield* request(daemon, { op: "snapshot", id: fromID(id) })
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
      const response = yield* request(daemon, { op: "terminate", id: fromID(id) })
      if (response.type !== "ok") return yield* unexpected(response)
      yield* bus.publish(Removed, { sessionID: terminal.sessionID, ptyID: id })
      return undefined
    })

    const shutdown = Effect.fn("PersistentPty.shutdown")(function* () {
      const response = yield* daemon.shutdown.pipe(Effect.mapError(unavailable))
      if (!response) return
      if (response.type !== "ok") return yield* unexpected(response)
    })

    const removeVisibleExit = (id: Pty.ID) => {
      if (removing.has(id)) return
      removing.add(id)
      runFork(
        remove(id).pipe(
          Effect.catchTags({
            "PersistentPty.NotFoundError": () => Effect.void,
            "PersistentPty.UnavailableError": (error) =>
              Effect.logWarning("failed to remove visible exited terminal", { id, error: error.message }),
          }),
          Effect.ensuring(Effect.sync(() => removing.delete(id))),
        ),
      )
    }

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
      const attachment = yield* daemon
        .subscribe(fromID(id), {
          ...input,
          onEvent: (event) => {
            if (event.type === "exited") removeVisibleExit(id)
            input.onEvent(event)
          },
        })
        .pipe(Effect.mapError(unavailable))
      return {
        info: toInfo(attachment.terminal),
        role: attachment.role,
        generation: attachment.generation,
        replay: attachment.replay,
        activate: attachment.activate,
        detach: attachment.detach,
      }
    })

    return Service.of({ list, get, create, write, resize, control, input, snapshot, remove, shutdown, attach })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node, Database.node, Global.node] })

const request = (daemon: DaemonTransport, value: object, start = false) =>
  daemon.request(value, start).pipe(Effect.mapError(unavailable))

const optionalRequest = (daemon: DaemonTransport, value: object) =>
  daemon.requestIfRunning(value).pipe(Effect.mapError(unavailable))

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
    sessionID: Session.ID.make(value.group_id),
    foregroundProcess: value.foreground_process,
    size: { cols: value.cols, rows: value.rows },
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
