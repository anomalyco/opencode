import { Schema } from "effect"
import { FileType } from "../environment/files.js"

// Messages between the home and a machine's worker. Bytes decode to `Uint8Array` and encode to base64, so the JSON
// form of a message is `Schema.encodeSync(ToWorker)(message)` and `Schema.decodeUnknownSync(FromWorker)(json)` reads it.

const Bytes = Schema.Uint8ArrayFromBase64

/** Names a process between the home and the worker. The home makes it when it starts the process. */
export const ProcessID = Schema.String.pipe(Schema.brand("Machine.ProcessID"))
export type ProcessID = typeof ProcessID.Type

/** One run of the worker program. */
export const Instance = Schema.String.pipe(Schema.brand("Machine.Instance"))
export type Instance = typeof Instance.Type

/** The signals a worker can send to a process. */
export const Signal = Schema.Literals(["SIGTERM", "SIGKILL", "SIGINT"])
export type Signal = typeof Signal.Type

const FileInfo = Schema.Struct({ type: FileType, size: Schema.Number, mtimeMs: Schema.Number })

const exit = { type: Schema.Literal("exit"), id: ProcessID, bytes: Schema.Number }
/** A file call and its reply carry the same `req`. */
const fs = { type: Schema.Literal("fs"), req: Schema.Number }

/** A peer link between two workers, named by the home. */
export const PeerLink = Schema.String.pipe(Schema.brand("Machine.PeerLink"))
export type PeerLink = typeof PeerLink.Type

/**
 * The first message of every connection, reconnects included. It names no machine: which machine sent it is the link's
 * to prove, never the worker's to say.
 */
export const Hello = Schema.Struct({
  type: Schema.Literal("hello"),
  /** The version of the messages after the handshake: a home that does not know a worker's version ends the connection. */
  protocol: Schema.Literal(3),
  os: Schema.String,
  arch: Schema.String,
  /** The worker's home directory, an absolute POSIX path: where `~` in a path on this machine starts. */
  home: Schema.String.check(Schema.isPattern(/^\//)),
  /** Made once per worker process start: a new value means every process the worker held is gone. */
  instance: Instance,
  processes: Schema.Array(
    Schema.Struct({
      id: ProcessID,
      pid: Schema.Number,
      state: Schema.Literals(["running", "exited"]),
      bytes: Schema.Number,
      code: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      signal: Schema.optionalKey(Schema.String),
    }),
  ),
  /** The peer links that are up: they outlive the worker's connection to the home. */
  links: Schema.optionalKey(Schema.Array(PeerLink)),
})
export type Hello = typeof Hello.Type

/** The home's grant for one file or one forward on a peer link. */
const Token = Schema.String
const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))
const peer = { req: Schema.Number }

export const FromWorker = Schema.Union([
  Hello,
  Schema.Struct({ type: Schema.Literal("started"), id: ProcessID, pid: Schema.Number }),
  /** A start, attach or kill that could not be done. */
  Schema.Struct({
    type: Schema.Literal("failed"),
    id: ProcessID,
    request: Schema.Literals(["start", "attach", "kill"]),
    message: Schema.String,
  }),
  /** `offset` is the position of the first byte of `data` in the process's merged stdout and stderr. */
  Schema.Struct({
    type: Schema.Literal("output"),
    id: ProcessID,
    offset: Schema.Number,
    stream: Schema.Literals(["stdout", "stderr"]),
    data: Bytes,
  }),
  Schema.Struct({ type: Schema.Literal("stdin"), id: ProcessID, req: Schema.Number, ok: Schema.Literal(true) }),
  Schema.Struct({
    type: Schema.Literal("stdin"),
    id: ProcessID,
    req: Schema.Number,
    ok: Schema.Literal(false),
    message: Schema.String,
  }),
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
  /** The one answer to each peer request, with its `req`. */
  Schema.Struct({ type: Schema.Literal("peer"), ...peer, ok: Schema.Literal(true) }),
  Schema.Struct({ type: Schema.Literal("peer"), ...peer, ok: Schema.Literal(false), message: Schema.String }),
  /** A link that was up ended, on either side. */
  Schema.Struct({ type: Schema.Literal("peer-closed"), link: PeerLink }),
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

/**
 * Peer requests: the home links two workers over Iroh, then grants single file transfers and port forwards on that link.
 * `key` is the other worker's key, which is also its Iroh endpoint id. Nothing on a link runs without a grant.
 */
export const PeerCall = Schema.Union([
  /** Accepts one connection from `key` naming `link`. Answered once it is up, or after 30 seconds without one. */
  Schema.Struct({ type: Schema.Literal("peer-accept"), ...peer, link: PeerLink, key: Schema.String }),
  /** Dials `key` and names `link`. Answered once the other worker accepted. */
  Schema.Struct({ type: Schema.Literal("peer-connect"), ...peer, link: PeerLink, key: Schema.String }),
  /** Takes one file presenting `token` on `link` and writes it to `path` atomically. Answered once it is written. */
  Schema.Struct({ type: Schema.Literal("peer-receive"), ...peer, link: PeerLink, token: Token, path: Schema.String }),
  /** Sends the file at `path` on `link` with `token`. Answered once the other worker wrote it. */
  Schema.Struct({ type: Schema.Literal("peer-send"), ...peer, link: PeerLink, token: Token, path: Schema.String }),
  /** Connects each stream presenting `token` on `link` to its own `127.0.0.1:port`. */
  Schema.Struct({ type: Schema.Literal("peer-allow"), ...peer, link: PeerLink, token: Token, port: Port }),
  /** Listens on `127.0.0.1:port` and carries each connection over `link` with `token`. */
  Schema.Struct({ type: Schema.Literal("peer-forward"), ...peer, link: PeerLink, token: Token, port: Port }),
  /** Ends the grant or listener of `token`: a pending receive fails. */
  Schema.Struct({ type: Schema.Literal("peer-revoke"), ...peer, token: Token }),
  Schema.Struct({ type: Schema.Literal("peer-close"), ...peer, link: PeerLink }),
])
export type PeerCall = typeof PeerCall.Type

export const ToWorker = Schema.Union([
  /** Starts the process and attaches to its output from byte 0. */
  Schema.Struct({
    type: Schema.Literal("start"),
    id: ProcessID,
    argv: Schema.Array(Schema.String),
    cwd: Schema.String,
    /** Set over the worker's own environment. */
    env: Schema.Record(Schema.String, Schema.String),
    stdin: Schema.Boolean,
  }),
  /** Acknowledged after writing to the OS pipe. Null closes it; never replayed. */
  Schema.Struct({ type: Schema.Literal("stdin"), id: ProcessID, req: Schema.Number, data: Schema.NullOr(Bytes) }),
  /** Sends output from byte `from` on, then the exit once every byte is sent. Replaces an earlier attach. */
  Schema.Struct({ type: Schema.Literal("attach"), id: ProcessID, from: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("kill"), id: ProcessID, signal: Signal }),
  /** Sent once the home has the process's exit: the worker may forget the process and its output. */
  Schema.Struct({ type: Schema.Literal("release"), id: ProcessID }),
  FileCall,
  PeerCall,
])
export type ToWorker = typeof ToWorker.Type

export * as MachineWire from "./wire.js"
