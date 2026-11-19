import { Schema } from "effect"
import { FileType } from "../environment/files.js"

// Messages between the home and a machine's worker. Bytes decode to `Uint8Array` and encode to base64, so the JSON
// form of a message is `Schema.encodeSync(ToWorker)(message)` and `Schema.decodeUnknownSync(FromWorker)(json)` reads it.

const Bytes = Schema.Uint8ArrayFromBase64

/** The signals a worker can send to a process. */
export const Signal = Schema.Literals(["SIGTERM", "SIGKILL", "SIGINT"])
export type Signal = typeof Signal.Type

const FileInfo = Schema.Struct({ type: FileType, size: Schema.Number, mtimeMs: Schema.Number })

const exit = { type: Schema.Literal("exit"), id: Schema.String, bytes: Schema.Number }
/** A file call and its reply carry the same `req`. */
const fs = { type: Schema.Literal("fs"), req: Schema.Number }

/** The first message of every connection, reconnects included. */
export const Hello = Schema.Struct({
  type: Schema.Literal("hello"),
  name: Schema.String,
  os: Schema.String,
  arch: Schema.String,
  /** Made once per worker process start: a new value means every process the worker held is gone. */
  instance: Schema.String,
  processes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      pid: Schema.Number,
      state: Schema.Literals(["running", "exited"]),
      bytes: Schema.Number,
      code: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      signal: Schema.optionalKey(Schema.String),
    }),
  ),
})
export type Hello = typeof Hello.Type

export const FromWorker = Schema.Union([
  Hello,
  Schema.Struct({ type: Schema.Literal("started"), id: Schema.String, pid: Schema.Number }),
  /** A start, attach or kill that could not be done. */
  Schema.Struct({
    type: Schema.Literal("failed"),
    id: Schema.String,
    request: Schema.Literals(["start", "attach", "kill"]),
    message: Schema.String,
  }),
  /** `offset` is the position of the first byte of `data` in the process's merged stdout and stderr. */
  Schema.Struct({ type: Schema.Literal("output"), id: Schema.String, offset: Schema.Number, data: Bytes }),
  Schema.Struct({ ...exit, code: Schema.Number }),
  Schema.Struct({ ...exit, code: Schema.Null, signal: Schema.String }),
  Schema.Struct({
    ...fs,
    ok: Schema.Literal(true),
    result: Schema.Union([
      Schema.Null,
      FileInfo,
      Schema.Array(Schema.Struct({ name: Schema.String, type: FileType })),
      Schema.Struct({ info: FileInfo, bytes: Bytes }),
    ]),
  }),
  Schema.Struct({
    ...fs,
    ok: Schema.Literal(false),
    error: Schema.Struct({
      kind: Schema.Literals(["not_found", "wrong_kind", "failed"]),
      message: Schema.String,
      actual: Schema.optionalKey(FileType),
    }),
  }),
])
export type FromWorker = typeof FromWorker.Type

/** File calls, with the semantics of the environment's `Files`. */
export const FileCall = Schema.Union([
  Schema.Struct({ ...fs, call: Schema.Literals(["stat", "list", "remove", "mkdir"]), path: Schema.String }),
  Schema.Struct({
    ...fs,
    call: Schema.Literal("read"),
    path: Schema.String,
    range: Schema.optional(Schema.Struct({ offset: Schema.Number, length: Schema.Number })),
  }),
  Schema.Struct({ ...fs, call: Schema.Literals(["write", "append"]), path: Schema.String, bytes: Bytes }),
  Schema.Struct({ ...fs, call: Schema.Literal("move"), from: Schema.String, to: Schema.String }),
])
export type FileCall = typeof FileCall.Type

export const ToWorker = Schema.Union([
  /** Starts the process and attaches to its output from byte 0. */
  Schema.Struct({
    type: Schema.Literal("start"),
    id: Schema.String,
    argv: Schema.Array(Schema.String),
    cwd: Schema.String,
    /** Set over the worker's own environment. */
    env: Schema.Record(Schema.String, Schema.String),
  }),
  /** Sends output from byte `from` on, then the exit once every byte is sent. Replaces an earlier attach. */
  Schema.Struct({ type: Schema.Literal("attach"), id: Schema.String, from: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("kill"), id: Schema.String, signal: Signal }),
  /** Sent once the home has the process's exit: the worker may forget the process and its output. */
  Schema.Struct({ type: Schema.Literal("release"), id: Schema.String }),
  FileCall,
])
export type ToWorker = typeof ToWorker.Type

export * as MachineWire from "./wire.js"
