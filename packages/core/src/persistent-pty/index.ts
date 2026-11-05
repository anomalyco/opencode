export * as PersistentPty from "./index.js"

import { stat } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import {
  Added,
  Handoff,
  PersistentPty,
  ReadLines,
  Removed,
  Updated,
  type ReadResult,
} from "@opencode/schema/persistent-pty"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { Bus } from "../bus.js"
import { Pty } from "@opencode/schema/pty"
import { Global } from "@opencode/util/global"
import { ShellSelect } from "../shell/select.js"
import {
  makeDaemonTransport,
  type DaemonAttachment,
  type DaemonError,
  type DaemonTransport,
  type Exited,
  type Metadata,
  type ProcessInfo,
  type Role,
  type Signal,
  type SubscribeInput,
  type WireResponse,
} from "./daemon.js"
import { resolveBinary } from "#persistent-pty-binary"

export type { Metadata, Role, Signal, StreamEvent } from "./daemon.js"
export { Handoff } from "@opencode/schema/persistent-pty"
export { available } from "#persistent-pty-binary"

export const Options = Schema.Struct({
  handoff: Schema.optional(Handoff),
  /** Parent of per-server daemon runtime directories; defaults to `<state>/pty`. */
  root: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export type Info = PersistentPty.Info

export type Snapshot = PersistentPty.Snapshot

export type Attachment = {
  readonly info: Info
  readonly role: Role
  readonly generation: number
  readonly replay: DaemonAttachment["replay"]
  readonly activate: () => void
  readonly detach: () => void
}

/** The daemon could not be reached or started; the request never ran. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("PersistentPty.UnavailableError", {
  message: Schema.String,
}) {}

/** The daemon rejected the request, or its reply was lost after it was sent, so it may have run. */
export class RequestError extends Schema.TaggedError<RequestError>()("PersistentPty.RequestError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PersistentPty.NotFoundError", {
  ptyID: Pty.ID,
}) {}

export class ProcessNotFoundError extends Schema.TaggedError<ProcessNotFoundError>()(
  "PersistentPty.ProcessNotFoundError",
  { processID: Schema.Number },
) {}

export class InvalidCwdError extends Schema.TaggedError<InvalidCwdError>()("PersistentPty.InvalidCwdError", {
  cwd: Schema.String,
  message: Schema.String,
}) {}

/** A non-PTY process run by the daemon, its output written to `outputPath`. */
export type PipeInfo = {
  readonly id: number
  readonly pid: number | undefined
  readonly command: readonly string[]
  readonly cwd: string
  readonly groupID: string
  readonly lifecycle:
    | { readonly status: "running" }
    | { readonly status: "exited"; readonly exitCode: number | undefined; readonly signal: string | undefined }
    | { readonly status: "failed"; readonly message: string }
  /** Bytes counted so far; the file can hold a little more. Pair only bytes up to here with `outputLines`. */
  readonly outputTail: number
  readonly outputLines: number
  readonly outputPath: string
  readonly outputError: string | undefined
  readonly metadata: Metadata
  readonly startedAt: number
  readonly exitedAt: number | undefined
}

export type PipeExit = {
  readonly exitCode: number | undefined
  readonly signal: string | undefined
  /** Runs past the file's size when `outputError` is set; use the file's real size instead. */
  readonly finalOffset: number
  readonly outputLines: number
  readonly outputError: string | undefined
  readonly exitedAt: number
}

export type CreatePipeInput = {
  readonly program: string
  readonly args: readonly string[]
  /** Absolute. */
  readonly cwd: string
  /** The child's whole environment; the daemon's own is not inherited. */
  readonly env: Readonly<Record<string, string>>
  readonly groupID: string
  /** Absolute; truncated on open, symlinks refused. */
  readonly outputPath: string
  readonly metadata: Metadata
}

export interface Interface {
  readonly list: (sessionID?: Session.ID) => Effect.Effect<Info[], UnavailableError>
  readonly get: (id: Pty.ID) => Effect.Effect<Info, NotFoundError | UnavailableError>
  readonly create: (
    sessionID: Session.ID,
    input: {
      readonly command?: string
      readonly args: readonly string[]
      readonly cwd?: string
      readonly title: string
      readonly env: Readonly<Record<string, string>>
      readonly cols?: number
      readonly rows?: number
    },
  ) => Effect.Effect<Info, InvalidCwdError | UnavailableError>
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
  readonly rename: (id: Pty.ID, title: string | null) => Effect.Effect<Info, NotFoundError | UnavailableError>
  readonly snapshot: (id: Pty.ID) => Effect.Effect<Snapshot, NotFoundError | UnavailableError>
  readonly read: (sessionID: Session.ID, lines?: number) => Effect.Effect<ReadResult | null, UnavailableError>
  readonly remove: (id: Pty.ID) => Effect.Effect<void, NotFoundError | UnavailableError>
  readonly shutdown: () => Effect.Effect<void, UnavailableError>
  readonly handoff: () => Effect.Effect<Handoff | null, UnavailableError>
  readonly attach: (
    id: Pty.ID,
    input: SubscribeInput,
  ) => Effect.Effect<Attachment, NotFoundError | UnavailableError>
  /** Starts the daemon if needed. Fall back to another spawner only on `UnavailableError`. */
  readonly createPipe: (input: CreatePipeInput) => Effect.Effect<PipeInfo, UnavailableError | RequestError>
  /** Resolves when the process exits, on its own connection with no timeout; interrupting closes it. */
  readonly waitPipe: (id: number) => Effect.Effect<PipeExit, UnavailableError | RequestError>
  /** `ProcessNotFoundError` for an unknown id, a PTY, or when no daemon is running. */
  readonly getPipe: (id: number) => Effect.Effect<PipeInfo, ProcessNotFoundError | UnavailableError>
  /** Signals the process group without forgetting the process; `waitPipe` then reports the signal. */
  readonly signalPipe: (id: number, signal: Signal) => Effect.Effect<void, UnavailableError | RequestError>
  /** Replaces the stored metadata. */
  readonly setPipeMetadata: (id: number, metadata: Metadata) => Effect.Effect<void, UnavailableError | RequestError>
  /** Kills the process if it still runs and forgets it; the output file is left alone. */
  readonly terminatePipe: (id: number) => Effect.Effect<void, UnavailableError | RequestError>
  /** Never starts the daemon; empty when none is running. */
  readonly listPipes: () => Effect.Effect<PipeInfo[], UnavailableError | RequestError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PersistentPty") {}

const makeLayer = (options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const global = yield* Global.Service
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      let binary: Promise<string> | undefined
      const daemon = yield* makeDaemonTransport(
        options.root ?? path.join(global.state, "pty"),
        crypto.randomUUID(),
        () =>
          (binary ??= resolveBinary(global.bin).catch((error) => {
            binary = undefined
            throw error
          })),
        options.handoff,
      ).pipe(Effect.mapError(unavailable))
      const removing = new Set<Pty.ID>()
      // Controller activity selects a terminal; observer reads and pane visibility do not.
      const current = new Map<Session.ID, Pty.ID>()

      const list = Effect.fn("PersistentPty.list")(function* (sessionID?: Session.ID) {
        const response = yield* optionalRequest(daemon, { op: "list", mode: "pty" })
        if (!response) return []
        if (response.type !== "processes") return yield* unexpected(response)
        return response.processes
          .map(toInfo)
          .filter((terminal) => sessionID === undefined || terminal.sessionID === sessionID)
      })

      const get = Effect.fn("PersistentPty.get")(function* (id: Pty.ID) {
        const found = yield* lookup(daemon, fromID(id)).pipe(Effect.mapError(unavailable))
        if (found?.mode !== "pty") return yield* new NotFoundError({ ptyID: id })
        return toInfo(found)
      })

      const create = Effect.fn("PersistentPty.create")(function* (
        sessionID: Session.ID,
        input: Parameters<Interface["create"]>[1],
      ) {
        const cwd = path.resolve(input.cwd ?? "/")
        // opencode-pty's PTY library silently falls back to $HOME when the cwd is not a directory.
        const directory = yield* Effect.promise(() =>
          stat(cwd).then(
            (info) => info.isDirectory(),
            () => false,
          ),
        )
        if (!directory) return yield* new InvalidCwdError({ cwd, message: `cwd is not a directory: ${cwd}` })
        const response = yield* request(
          daemon,
          {
            op: "create_pty",
            program: input.command ?? ShellSelect.environment(global.bin),
            args: input.args,
            cwd,
            title: input.title,
            group_id: sessionID,
            env: input.env,
            cols: input.cols ?? 80,
            rows: input.rows ?? 24,
          },
          true,
        )
        if (response.type !== "created") return yield* unexpected(response)
        const terminal = toInfo(response.process)
        yield* bus.publish(Added, { sessionID, terminal })
        return terminal
      })

      // Sends a terminal command that answers "ok"; `select` marks the terminal as its session's current one.
      const command = (id: Pty.ID, op: string, body: object, select: boolean) =>
        Effect.gen(function* () {
          const terminal = yield* get(id)
          const response = yield* request(daemon, { op, id: fromID(id), ...body })
          if (response.type !== "ok") return yield* unexpected(response)
          if (select) current.set(terminal.sessionID, id)
        })

      const write = Effect.fn("PersistentPty.write")((id: Pty.ID, data: string, attachmentID?: string) =>
        command(
          id,
          "write",
          { attachment_id: attachmentID ?? null, data_base64: Buffer.from(data).toString("base64") },
          false,
        ),
      )

      const resize = Effect.fn("PersistentPty.resize")((id: Pty.ID, cols: number, rows: number, attachmentID?: string) =>
        command(id, "resize", { attachment_id: attachmentID ?? null, cols, rows }, true),
      )

      const control = Effect.fn("PersistentPty.control")(
        (id: Pty.ID, attachmentID: string, cols: number, rows: number) =>
          command(id, "control", { attachment_id: attachmentID, cols, rows }, true),
      )

      const input = Effect.fn("PersistentPty.input")(
        (id: Pty.ID, attachmentID: string, cols: number, rows: number, data: Uint8Array) =>
          command(
            id,
            "input",
            { attachment_id: attachmentID, cols, rows, data_base64: Buffer.from(data).toString("base64") },
            true,
          ),
      )

      const rename = Effect.fn("PersistentPty.rename")(function* (id: Pty.ID, title: string | null) {
        const terminal = yield* get(id)
        const response = yield* request(daemon, { op: "rename", id: fromID(id), title })
        if (response.type !== "ok") return yield* unexpected(response)
        const renamed = yield* get(id)
        yield* bus.publish(Updated, { sessionID: terminal.sessionID, terminal: renamed })
        return renamed
      })

      const snapshot = Effect.fn("PersistentPty.snapshot")(function* (id: Pty.ID) {
        yield* get(id)
        const response = yield* request(daemon, { op: "snapshot", id: fromID(id) })
        if (response.type !== "snapshot") return yield* unexpected(response)
        return {
          info: toInfo(response.process),
          text: response.text,
          checkpoint: Buffer.from(response.checkpoint_base64, "base64"),
          cursor: { x: response.cursor_x, y: response.cursor_y },
        }
      })

      const read = Effect.fn("PersistentPty.read")(function* (sessionID: Session.ID, lines?: number) {
        if (lines !== undefined && !Schema.is(ReadLines)(lines))
          return yield* new UnavailableError({ message: "lines must be an integer between 1 and 65535" })
        const id = current.get(sessionID)
        if (!id) return null
        const terminal = yield* get(id).pipe(Effect.catchTag("PersistentPty.NotFoundError", () => Effect.succeed(null)))
        if (!terminal || terminal.sessionID !== sessionID) {
          if (current.get(sessionID) === id) current.delete(sessionID)
          return null
        }
        // Let the daemon choose the live height in the same snapshot when lines is omitted.
        const response = yield* request(daemon, { op: "read_rows", id: fromID(id), rows: lines })
        if (response.type !== "rows") return yield* unexpected(response)
        const info = toInfo(response.process)
        return {
          ptyID: info.id,
          title: info.title,
          cwd: info.cwd,
          foregroundProcess: info.foregroundProcess,
          screen: {
            text: response.lines.join("\n"),
            cols: info.size.cols,
            rows: info.size.rows,
            cursor: { x: response.cursor_x, y: response.cursor_y },
          },
        }
      })

      const remove = Effect.fn("PersistentPty.remove")(function* (id: Pty.ID) {
        const terminal = yield* get(id)
        const response = yield* request(daemon, { op: "terminate", id: fromID(id) })
        if (response.type !== "ok") return yield* unexpected(response)
        if (current.get(terminal.sessionID) === id) current.delete(terminal.sessionID)
        yield* bus.publish(Removed, { sessionID: terminal.sessionID, ptyID: id })
        return undefined
      })

      const shutdown = Effect.fn("PersistentPty.shutdown")(function* () {
        const response = yield* daemon.shutdown.pipe(Effect.mapError(unavailable))
        current.clear()
        if (!response) return
        if (response.type !== "ok") return yield* unexpected(response)
      })

      const handoff = Effect.fn("PersistentPty.handoff")(() => daemon.handoff.pipe(Effect.mapError(unavailable)))

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

      const removeSession = (sessionID: Session.ID) =>
        list(sessionID).pipe(
          Effect.flatMap((terminals) =>
            Effect.forEach(
              terminals,
              (terminal) =>
                remove(terminal.id).pipe(
                  Effect.catchTags({
                    "PersistentPty.NotFoundError": () => Effect.void,
                    "PersistentPty.UnavailableError": (error) =>
                      Effect.logWarning("failed to remove deleted session's terminal", {
                        sessionID,
                        id: terminal.id,
                        error: error.message,
                      }),
                  }),
                ),
              { discard: true },
            ),
          ),
          Effect.catchTag("PersistentPty.UnavailableError", (error) =>
            Effect.logWarning("failed to list deleted session's terminals", { sessionID, error: error.message }),
          ),
          Effect.ensuring(Effect.sync(() => current.delete(sessionID))),
        )

      // Errors are handled per event so one failed cleanup does not end the subscription.
      yield* bus.subscribe(SessionEvent.Deleted).pipe(
        Stream.runForEach((event) => removeSession(event.data.sessionID)),
        Effect.forkScoped({ startImmediately: true }),
      )

      const attach = Effect.fn("PersistentPty.attach")(function* (
        id: Pty.ID,
        input: Parameters<Interface["attach"]>[1],
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
        const info = toInfo(attachment.terminal)
        if (attachment.role === "controller") current.set(info.sessionID, id)
        return {
          info,
          role: attachment.role,
          generation: attachment.generation,
          replay: attachment.replay,
          activate: attachment.activate,
          detach: attachment.detach,
        }
      })

      const createPipe = Effect.fn("PersistentPty.createPipe")(function* (input: CreatePipeInput) {
        const response = yield* daemon
          .request(
            {
              op: "create_pipe",
              program: input.program,
              args: input.args,
              cwd: input.cwd,
              env: input.env,
              group_id: input.groupID,
              output_path: input.outputPath,
              metadata: input.metadata,
            },
            true,
          )
          .pipe(Effect.mapError(pipeError))
        if (response.type !== "created") return yield* unexpectedPipe(response)
        return toPipeInfo(response.process)
      })

      const waitPipe = Effect.fn("PersistentPty.waitPipe")(function* (id: number) {
        return toPipeExit(yield* daemon.wait(id).pipe(Effect.mapError(pipeError)))
      })

      const getPipe = Effect.fn("PersistentPty.getPipe")(function* (id: number) {
        const found = yield* lookup(daemon, id).pipe(Effect.mapError(unavailable))
        if (found?.mode !== "pipe") return yield* new ProcessNotFoundError({ processID: id })
        return toPipeInfo(found)
      })

      const pipeCommand = (value: object) =>
        Effect.gen(function* () {
          const response = yield* daemon.request(value).pipe(Effect.mapError(pipeError))
          if (response.type !== "ok") return yield* unexpectedPipe(response)
        })

      const signalPipe = Effect.fn("PersistentPty.signalPipe")((id: number, signal: Signal) =>
        pipeCommand({ op: "signal", id, signal }),
      )

      const setPipeMetadata = Effect.fn("PersistentPty.setPipeMetadata")((id: number, metadata: Metadata) =>
        pipeCommand({ op: "set_metadata", id, metadata }),
      )

      const terminatePipe = Effect.fn("PersistentPty.terminatePipe")((id: number) =>
        pipeCommand({ op: "terminate", id }),
      )

      const listPipes = Effect.fn("PersistentPty.listPipes")(function* () {
        const response = yield* daemon.requestIfRunning({ op: "list", mode: "pipe" }).pipe(Effect.mapError(pipeError))
        if (!response) return []
        if (response.type !== "processes") return yield* unexpectedPipe(response)
        return response.processes.map(toPipeInfo)
      })

      return Service.of({
        list,
        get,
        create,
        write,
        resize,
        control,
        input,
        rename,
        snapshot,
        read,
        remove,
        shutdown,
        handoff,
        attach,
        createPipe,
        waitPipe,
        getPipe,
        signalPipe,
        setPipeMetadata,
        terminatePipe,
        listPipes,
      })
    }),
  )

export const layer = makeLayer()
export const configured = (options?: Options) =>
  makeGlobalNode({
    service: Service,
    layer: options === undefined ? layer : makeLayer(options),
    deps: [Bus.node, Global.node],
  })
export const node = configured()

const request = (daemon: DaemonTransport, value: object, start = false) =>
  daemon.request(value, start).pipe(Effect.mapError(unavailable))

const optionalRequest = (daemon: DaemonTransport, value: object) =>
  daemon.requestIfRunning(value).pipe(Effect.mapError(unavailable))

// `get` fails only for an unknown id, and no running daemon has no processes.
const lookup = (daemon: DaemonTransport, id: number) =>
  daemon.requestIfRunning({ op: "get", id }).pipe(
    Effect.catchIf(
      (error) => error.kind === "request",
      () => Effect.succeed(undefined),
    ),
    Effect.flatMap((response) => {
      if (!response) return Effect.succeed(undefined)
      if (response.type !== "process") return Effect.fail(new Error(`unexpected opencode-pty response: ${response.type}`))
      return Effect.succeed(response.process)
    }),
  )

const unexpected = (response: WireResponse) =>
  Effect.fail(new UnavailableError({ message: `unexpected opencode-pty response: ${response.type}` }))

const unavailable = (error: unknown) =>
  new UnavailableError({ message: error instanceof Error ? error.message : String(error) })

// Only a failure before the request was sent is safe to retry somewhere else.
const pipeError = (error: DaemonError) =>
  error.kind === "request" || error.kind === "response"
    ? new RequestError({ message: error.message })
    : new UnavailableError({ message: error.message })

const unexpectedPipe = (response: WireResponse) =>
  Effect.fail(new RequestError({ message: `unexpected opencode-pty response: ${response.type}` }))

function toInfo(value: ProcessInfo): Info {
  if (!value.pty) throw new Error(`opencode-pty process ${value.id} is not a terminal`)
  const status = value.lifecycle.status
  return {
    ...Pty.Info.make({
      id: toID(value.id),
      title: value.pty.title,
      command: value.command[0] || "",
      args: value.command.slice(1),
      cwd: value.cwd,
      status: status === "running" ? "running" : "exited",
      pid: value.pid ?? 0,
      ...(value.lifecycle.status === "exited" ? { exitCode: value.lifecycle.exit_code ?? undefined } : {}),
    }),
    // Terminals are always created with a session ID as their group.
    sessionID: Session.ID.make(value.group_id),
    userTitle: value.pty.user_title,
    foregroundProcess: value.pty.foreground_process,
    size: { cols: value.pty.cols, rows: value.pty.rows },
    output: { head: value.output_head, tail: value.output_tail },
  }
}

function toPipeInfo(value: ProcessInfo): PipeInfo {
  if (!value.pipe) throw new Error(`opencode-pty process ${value.id} is not a pipe process`)
  return {
    id: value.id,
    pid: value.pid ?? undefined,
    command: value.command,
    cwd: value.cwd,
    groupID: value.group_id,
    lifecycle:
      value.lifecycle.status === "exited"
        ? {
            status: "exited",
            exitCode: value.lifecycle.exit_code ?? undefined,
            signal: value.lifecycle.signal ?? undefined,
          }
        : value.lifecycle,
    outputTail: value.output_tail,
    outputLines: value.pipe.output_lines,
    outputPath: value.pipe.output_path,
    outputError: value.pipe.output_error ?? undefined,
    metadata: value.pipe.metadata,
    startedAt: value.started_at,
    exitedAt: value.exited_at ?? undefined,
  }
}

function toPipeExit(value: Exited): PipeExit {
  return {
    exitCode: value.exit_code ?? undefined,
    signal: value.signal ?? undefined,
    finalOffset: value.final_offset,
    outputLines: value.output_lines ?? 0,
    outputError: value.output_error ?? undefined,
    exitedAt: value.exited_at,
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
