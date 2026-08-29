export * as AttachmentStore from "./attachment-store"

import { createHash } from "crypto"
import path from "path"
import { Attachment } from "@opencode-ai/schema/attachment"
import { Context, Duration, Effect, FileSystem, Layer, Option, Schedule, Schema, Semaphore, Stream } from "effect"
import { Database } from "./database/database"
import { Node } from "./effect/app-node"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { SessionMessage } from "./session/message"
import { SessionSchema } from "./session/schema"
import { SessionTable } from "./session/sql"
import { NonNegativeInt } from "./schema"

export const MANAGED_DIRECTORY = "attachments"
export const MAX_FILE_BYTES = Attachment.MAX_FILE_BYTES
export const MAX_SESSION_BYTES = 100 * 1024 * 1024
export const MAX_GLOBAL_BYTES = 1024 * 1024 * 1024
export const UNBOUND_RETENTION = Duration.hours(24)

const MAX_NAME_BYTES = 180
const metadataName = "metadata.json"
const uploadName = ".upload"
const metadataUploadName = ".metadata"
const internalNames = new Set([metadataName, uploadName, metadataUploadName])

const Metadata = Schema.Struct({
  id: Attachment.ID,
  sessionID: SessionSchema.ID,
  originalName: Schema.String,
  storedName: Schema.String,
  clientMime: Schema.String,
  detectedMime: Schema.String,
  size: NonNegativeInt,
  sha256: Schema.String,
  createdAt: NonNegativeInt,
  boundMessageID: SessionMessage.ID.pipe(Schema.optional),
  nativeMediaDeliveredAt: NonNegativeInt.pipe(Schema.optional),
})
type Metadata = typeof Metadata.Type

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("AttachmentStore.StorageError", {
  operation: Schema.Literals(["allocate", "scan", "read", "write", "rename", "remove"]),
  cause: Schema.Defect(),
}) {}

export class QuotaError extends Schema.TaggedErrorClass<QuotaError>()("AttachmentStore.QuotaError", {
  scope: Schema.Literals(["file", "session", "global"]),
  maximumBytes: NonNegativeInt,
}) {}

export class FilenameError extends Schema.TaggedErrorClass<FilenameError>()("AttachmentStore.FilenameError", {
  reason: Schema.Literal("nul"),
}) {}

export class ReferenceError extends Schema.TaggedErrorClass<ReferenceError>()("AttachmentStore.ReferenceError", {
  sessionID: SessionSchema.ID,
  attachmentID: Attachment.ID.pipe(Schema.optional),
}) {}

export type Error = StorageError | QuotaError | FilenameError | ReferenceError
export type UploadError = StorageError | QuotaError | FilenameError
export type Info = Attachment.Info

export interface Resolved extends Attachment.Info {
  readonly path: string
  readonly nativeMediaDelivered: boolean
}

export interface UploadInput<E, R> {
  readonly sessionID: SessionSchema.ID
  readonly name: string
  readonly contentType: string
  readonly content: Stream.Stream<Uint8Array, E, R>
}

export interface Interface {
  readonly upload: <E, R>(input: UploadInput<E, R>) => Effect.Effect<Attachment.Info, UploadError | E, R>
  readonly resolve: (input: {
    readonly sessionID: SessionSchema.ID
    readonly attachmentID: Attachment.ID
  }) => Effect.Effect<Resolved, ReferenceError | StorageError>
  readonly bind: (input: {
    readonly sessionID: SessionSchema.ID
    readonly attachmentID: Attachment.ID
    readonly messageID: SessionMessage.ID
  }) => Effect.Effect<Resolved, ReferenceError | StorageError>
  readonly markNativeMediaDelivered: (input: {
    readonly sessionID: SessionSchema.ID
    readonly attachmentID: Attachment.ID
  }) => Effect.Effect<Resolved, ReferenceError | StorageError>
  readonly remove: (input: {
    readonly sessionID: SessionSchema.ID
    readonly attachmentID: Attachment.ID
  }) => Effect.Effect<void, StorageError>
  readonly cleanup: (sessions?: ReadonlySet<SessionSchema.ID>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AttachmentStore") {}

export interface Limits {
  readonly file: number
  readonly session: number
  readonly global: number
}

interface Usage {
  readonly sessions: Map<SessionSchema.ID, number>
  global: number
}

interface Reservation {
  readonly sessionID: SessionSchema.ID
  bytes: number
}

interface StoreState {
  usage: Usage | undefined
  reserved: number
}

const defaults: Limits = {
  file: MAX_FILE_BYTES,
  session: MAX_SESSION_BYTES,
  global: MAX_GLOBAL_BYTES,
}

export const isManagedURI = (uri: string) => /^opencode:/i.test(uri)

export const attachmentID = (uri: string) => {
  const match = /^opencode:\/\/attachment\/(att_[0-9A-Za-z]+)$/.exec(uri)
  return match ? Attachment.ID.make(match[1]) : undefined
}

const controlRanges = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
] satisfies ReadonlyArray<readonly [number, number]>

const safeCharacter = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return !controlRanges.some(([start, end]) => code >= start && code <= end)
}

const safeBasename = (input: string) =>
  Array.from(input.normalize("NFC").split(/[\\/]/).at(-1) ?? "")
    .filter(safeCharacter)
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")

const usableName = (input: string) => (input === "" || input === "." || input === ".." ? "attachment" : input)

const deviceStem = (name: string, stem: string) => {
  const candidate = (name.split(".", 1)[0] ?? "").replace(/[. ]+$/g, "")
  const device = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(candidate)
  return device || internalNames.has(name.toLowerCase()) ? `_${stem}` : stem
}

const takeBytes = (input: string, maximum: number) => {
  const state = { value: "", bytes: 0 }
  for (const char of input) {
    const bytes = Buffer.byteLength(char)
    if (state.bytes + bytes > maximum) break
    state.value += char
    state.bytes += bytes
  }
  return state.value
}

export const sanitizeName = (input: string) => {
  if (input.includes("\0")) return Effect.fail(new FilenameError({ reason: "nul" }))
  const fallback = usableName(safeBasename(input))
  const dot = fallback.lastIndexOf(".")
  const extension = dot > 0 ? takeBytes(fallback.slice(dot), 24) : ""
  const stem = dot > 0 ? fallback.slice(0, dot) : fallback
  const prefixed = deviceStem(fallback, stem)
  const name = `${takeBytes(prefixed, MAX_NAME_BYTES - Buffer.byteLength(extension))}${extension}`
  return Effect.succeed(name || "attachment")
}

const sniff = (prefix: Uint8Array) => {
  const text = Buffer.from(prefix)
  if (text.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (text[0] === 0xff && text[1] === 0xd8 && text[2] === 0xff) return "image/jpeg"
  if (text.subarray(0, 6).toString() === "GIF87a" || text.subarray(0, 6).toString() === "GIF89a") return "image/gif"
  if (text.subarray(0, 4).toString() === "RIFF" && text.subarray(8, 12).toString() === "WEBP") return "image/webp"
  if (text.subarray(0, 5).toString() === "%PDF-") return "application/pdf"
  return "application/octet-stream"
}

const sessionDirectory = (root: string, sessionID: SessionSchema.ID) => path.join(root, encodeURIComponent(sessionID))
const attachmentDirectory = (root: string, sessionID: SessionSchema.ID, id: Attachment.ID) =>
  path.join(sessionDirectory(root, sessionID), id)

const directoryEntry = (entry: FSUtil.DirEntry) => entry.type === "directory"
const attachmentEntry = (entry: FSUtil.DirEntry) => entry.type === "directory" && /^att_[0-9A-Za-z]+$/.test(entry.name)
const namedEntry = (name: string) => (entry: FSUtil.DirEntry) => entry.name === name
const defined = <A>(value: A | undefined): value is A => value !== undefined

const makeLayer = (options: { readonly limits?: Partial<Limits>; readonly now?: () => number } = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const root = path.join(global.data, MANAGED_DIRECTORY)
      const limits = { ...defaults, ...options.limits }
      const now = options.now ?? Date.now
      const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()
      const quota = Semaphore.makeUnsafe(1)
      // TODO(review): Enforce the global quota across processes before multiple processes share one data directory.
      const state: StoreState = { usage: undefined, reserved: 0 }
      const decodeMetadata = Schema.decodeUnknownEffect(Metadata)

      const storage = (operation: StorageError["operation"], cause: unknown) => new StorageError({ operation, cause })
      const writeError = (cause: unknown) => storage("write", cause)
      const renameError = (cause: unknown) => storage("rename", cause)

      const readStoredMetadata = Effect.fn("AttachmentStore.readMetadata")(function* (file: string) {
        const input = yield* fs.readJson(file).pipe(Effect.mapError((cause) => storage("read", cause)))
        return yield* decodeMetadata(input).pipe(Effect.mapError((cause) => storage("read", cause)))
      })

      function storedSize(session: FSUtil.DirEntry, entry: FSUtil.DirEntry) {
        return readStoredMetadata(path.join(root, session.name, entry.name, metadataName)).pipe(
          Effect.map((metadata) => metadata.size),
          Effect.catch(() => Effect.succeed(0)),
        )
      }

      function scanSession(session: FSUtil.DirEntry) {
        return Effect.gen(function* () {
          const decoded = Option.getOrUndefined(Option.liftThrowable(decodeURIComponent)(session.name))
          if (!decoded || !Schema.is(SessionSchema.ID)(decoded)) return undefined
          const sessionID = SessionSchema.ID.make(decoded)
          const entries = yield* fs
            .readDirectoryEntries(path.join(root, session.name))
            .pipe(Effect.catch(() => Effect.succeed([])))
          const sizes = yield* Effect.forEach(entries.filter(attachmentEntry), (entry) => storedSize(session, entry))
          return [sessionID, sizes.reduce((sum, value) => sum + value, 0)] satisfies readonly [SessionSchema.ID, number]
        })
      }

      const scan = Effect.fn("AttachmentStore.scan")(function* () {
        const sessionEntries = yield* fs.readDirectoryEntries(root).pipe(Effect.catch(() => Effect.succeed([])))
        const sizes = yield* Effect.forEach(sessionEntries.filter(directoryEntry), scanSession)
        const sessions = new Map(sizes.filter(defined))
        return { sessions, global: Array.from(sessions.values()).reduce((sum, value) => sum + value, 0) }
      })

      const usage = Effect.fn("AttachmentStore.usage")(function* () {
        if (state.usage) return state.usage
        state.usage = yield* scan()
        return state.usage
      })

      const reserve = (reservation: Reservation, bytes: number) =>
        quota.withPermit(
          Effect.gen(function* () {
            const next = reservation.bytes + bytes
            if (next > limits.file) return yield* new QuotaError({ scope: "file", maximumBytes: limits.file })
            const current = yield* usage()
            if ((current.sessions.get(reservation.sessionID) ?? 0) + next > limits.session)
              return yield* new QuotaError({ scope: "session", maximumBytes: limits.session })
            if (current.global + state.reserved + bytes > limits.global)
              return yield* new QuotaError({ scope: "global", maximumBytes: limits.global })
            reservation.bytes = next
            state.reserved += bytes
          }),
        )

      const release = (reservation: Reservation) =>
        quota.withPermit(
          Effect.sync(() => {
            state.reserved -= reservation.bytes
            reservation.bytes = 0
          }),
        )

      const commit = (reservation: Reservation) =>
        quota.withPermit(
          Effect.gen(function* () {
            const current = yield* usage()
            state.reserved -= reservation.bytes
            current.global += reservation.bytes
            current.sessions.set(
              reservation.sessionID,
              (current.sessions.get(reservation.sessionID) ?? 0) + reservation.bytes,
            )
            reservation.bytes = 0
          }),
        )

      const allocate: (
        sessionID: SessionSchema.ID,
      ) => Effect.Effect<{ readonly id: Attachment.ID; readonly directory: string }, StorageError> = Effect.fn(
        "AttachmentStore.allocate",
      )(function* (sessionID: SessionSchema.ID) {
        yield* fs
          .makeDirectory(root, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError((cause) => storage("allocate", cause)))
        const rootEntry = (yield* fs
          .readDirectoryEntries(global.data)
          .pipe(Effect.mapError((cause) => storage("scan", cause)))).find((entry) => entry.name === MANAGED_DIRECTORY)
        if (rootEntry?.type !== "directory") return yield* new StorageError({ operation: "allocate", cause: "symlink" })
        yield* fs.chmod(root, 0o700).pipe(Effect.mapError((cause) => storage("allocate", cause)))
        const session = sessionDirectory(root, sessionID)
        yield* fs
          .makeDirectory(session, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError((cause) => storage("allocate", cause)))
        const entry = (yield* fs
          .readDirectoryEntries(root)
          .pipe(Effect.mapError((cause) => storage("scan", cause)))).find(
          (entry) => entry.name === path.basename(session),
        )
        if (entry?.type !== "directory") return yield* new StorageError({ operation: "allocate", cause: "symlink" })
        yield* fs.chmod(session, 0o700).pipe(Effect.mapError((cause) => storage("allocate", cause)))
        const id = Attachment.ID.create()
        const directory = attachmentDirectory(root, sessionID, id)
        const created = yield* fs.makeDirectory(directory, { mode: 0o700 }).pipe(
          Effect.as(true),
          Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
          Effect.mapError((cause) => storage("allocate", cause)),
        )
        if (!created) return yield* allocate(sessionID)
        return { id, directory }
      })

      const read = Effect.fn("AttachmentStore.resolve")(function* (input: {
        readonly sessionID: SessionSchema.ID
        readonly attachmentID: Attachment.ID
      }) {
        const directory = attachmentDirectory(root, input.sessionID, input.attachmentID)
        const entries = yield* fs
          .readDirectoryEntries(directory)
          .pipe(Effect.mapError(() => new ReferenceError({ ...input })))
        const metadataEntry = entries.find((entry) => entry.name === metadataName)
        if (metadataEntry?.type !== "file") return yield* new ReferenceError({ ...input })
        const metadata = yield* readStoredMetadata(path.join(directory, metadataName)).pipe(
          Effect.mapError(() => new ReferenceError({ ...input })),
        )
        if (metadata.id !== input.attachmentID || metadata.sessionID !== input.sessionID)
          return yield* new ReferenceError({ ...input })
        const fileEntry = entries.find((entry) => entry.name === metadata.storedName)
        if (fileEntry?.type !== "file") return yield* new ReferenceError({ ...input })
        const file = path.join(directory, metadata.storedName)
        const realDirectory = yield* fs
          .realPath(directory)
          .pipe(Effect.mapError(() => new ReferenceError({ ...input })))
        const real = yield* fs.realPath(file).pipe(Effect.mapError(() => new ReferenceError({ ...input })))
        if (!FSUtil.contains(realDirectory, real)) return yield* new ReferenceError({ ...input })
        return {
          id: metadata.id,
          uri: Attachment.URI.fromID(metadata.id),
          name: metadata.storedName,
          mime: metadata.detectedMime,
          size: metadata.size,
          path: real,
          nativeMediaDelivered: metadata.nativeMediaDeliveredAt !== undefined,
        }
      })

      const writeMetadata = Effect.fn("AttachmentStore.writeMetadata")(function* (
        directory: string,
        metadata: Metadata,
      ) {
        const temp = path.join(directory, metadataUploadName)
        yield* fs
          .writeFileString(temp, JSON.stringify(metadata, null, 2), { flag: "wx", mode: 0o600 })
          .pipe(Effect.mapError((cause) => storage("write", cause)))
        yield* fs
          .rename(temp, path.join(directory, metadataName))
          .pipe(Effect.mapError((cause) => storage("rename", cause)))
      })

      function sameFile(left: FileSystem.File.Info, right: FileSystem.File.Info) {
        const leftInode = Option.getOrUndefined(left.ino)
        const rightInode = Option.getOrUndefined(right.ino)
        return (
          left.type === "File" &&
          right.type === "File" &&
          left.dev === right.dev &&
          leftInode !== undefined &&
          leftInode === rightInode
        )
      }

      const uploadUnlocked = <E, R>(input: UploadInput<E, R>): Effect.Effect<Attachment.Info, UploadError | E, R> =>
        Effect.gen(function* () {
          const name = yield* sanitizeName(input.name)
          const allocated = yield* allocate(input.sessionID)
          const reservation: Reservation = { sessionID: input.sessionID, bytes: 0 }
          const hash = createHash("sha256")
          const prefix = Buffer.alloc(16)
          const progress = { prefix: 0 }
          function writeChunk(file: FileSystem.File, chunk: Uint8Array) {
            return Effect.gen(function* () {
              yield* reserve(reservation, chunk.byteLength)
              hash.update(chunk)
              const copied = Math.min(prefix.length - progress.prefix, chunk.byteLength)
              if (copied > 0) prefix.set(chunk.subarray(0, copied), progress.prefix)
              progress.prefix += copied
              yield* file.writeAll(chunk).pipe(Effect.mapError(writeError))
            })
          }
          function write() {
            return Effect.scoped(
              Effect.gen(function* () {
                const source = path.join(allocated.directory, uploadName)
                const file = yield* fs.open(source, { flag: "wx", mode: 0o600 }).pipe(Effect.mapError(writeError))
                function consume(chunk: Uint8Array) {
                  return writeChunk(file, chunk)
                }
                yield* Stream.runForEach(input.content, consume)
                yield* file.sync.pipe(Effect.mapError(writeError))
                return yield* finish(file, source)
              }),
            )
          }
          function finish(file: FileSystem.File, source: string) {
            return Effect.gen(function* () {
              const mime = sniff(prefix.subarray(0, progress.prefix))
              const size = reservation.bytes
              const realRoot = yield* fs.realPath(root).pipe(Effect.mapError(renameError))
              const realDirectory = yield* fs.realPath(allocated.directory).pipe(Effect.mapError(renameError))
              const realSource = yield* fs.realPath(source).pipe(Effect.mapError(renameError))
              const target = path.join(realDirectory, name)
              const entries = yield* fs.readDirectoryEntries(realDirectory).pipe(Effect.mapError(renameError))
              const sourceEntry = entries.find(namedEntry(uploadName))
              const descriptorInfo = yield* file.stat.pipe(Effect.mapError(renameError))
              const sourceInfo = yield* fs.stat(realSource).pipe(Effect.mapError(renameError))
              const sourceValid = ![
                sourceEntry?.type !== "file",
                entries.some(namedEntry(name)),
                !FSUtil.contains(realRoot, realDirectory),
                !FSUtil.contains(realDirectory, realSource),
                !FSUtil.contains(realDirectory, target),
                !sameFile(descriptorInfo, sourceInfo),
              ].includes(true)
              if (!sourceValid) return yield* new StorageError({ operation: "rename", cause: "containment" })
              yield* fs.rename(realSource, target).pipe(Effect.mapError(renameError))
              const realTarget = yield* fs.realPath(target).pipe(Effect.mapError(renameError))
              const targetEntry = (yield* fs
                .readDirectoryEntries(realDirectory)
                .pipe(Effect.mapError(renameError))).find(namedEntry(name))
              const targetInfo = yield* fs.stat(realTarget).pipe(Effect.mapError(renameError))
              const targetValid = ![
                targetEntry?.type !== "file",
                !FSUtil.contains(realDirectory, realTarget),
                !sameFile(descriptorInfo, targetInfo),
              ].includes(true)
              if (!targetValid) return yield* new StorageError({ operation: "rename", cause: "containment" })
              yield* writeMetadata(realDirectory, {
                id: allocated.id,
                sessionID: input.sessionID,
                originalName: input.name,
                storedName: name,
                clientMime: input.contentType,
                detectedMime: mime,
                size,
                sha256: hash.digest("hex"),
                createdAt: now(),
              })
              yield* commit(reservation)
              return Attachment.Info.make({
                id: allocated.id,
                uri: Attachment.URI.fromID(allocated.id),
                name,
                mime,
                size,
              })
            })
          }
          function discard() {
            return fs.remove(allocated.directory, { recursive: true }).pipe(Effect.catch(() => Effect.void))
          }
          return yield* write().pipe(Effect.onError(discard), Effect.ensuring(release(reservation)))
        })

      const upload: Interface["upload"] = (input) => locks.withLock(input.sessionID)(uploadUnlocked(input))

      const resolve: Interface["resolve"] = read

      const updateMetadata = Effect.fn("AttachmentStore.updateMetadata")(function* (
        input: { readonly sessionID: SessionSchema.ID; readonly attachmentID: Attachment.ID },
        update: (metadata: Metadata) => Metadata,
      ) {
        const resolved = yield* read(input)
        const directory = attachmentDirectory(root, input.sessionID, input.attachmentID)
        const metadata = yield* readStoredMetadata(path.join(directory, metadataName)).pipe(
          Effect.mapError(() => new ReferenceError({ ...input })),
        )
        const next = update(metadata)
        if (next === metadata) return resolved
        yield* fs
          .writeFileString(path.join(directory, metadataUploadName), JSON.stringify(next, null, 2), {
            flag: "wx",
            mode: 0o600,
          })
          .pipe(Effect.mapError((cause) => storage("write", cause)))
        yield* fs
          .rename(path.join(directory, metadataUploadName), path.join(directory, metadataName))
          .pipe(Effect.mapError((cause) => storage("rename", cause)))
        return { ...resolved, nativeMediaDelivered: next.nativeMediaDeliveredAt !== undefined }
      })

      const bind: Interface["bind"] = (input) =>
        locks.withLock(input.sessionID)(
          updateMetadata(input, (metadata) =>
            metadata.boundMessageID ? metadata : { ...metadata, boundMessageID: input.messageID },
          ),
        )

      const markNativeMediaDelivered: Interface["markNativeMediaDelivered"] = (input) =>
        locks.withLock(input.sessionID)(
          updateMetadata(input, (metadata) =>
            metadata.nativeMediaDeliveredAt === undefined
              ? { ...metadata, nativeMediaDeliveredAt: now() }
              : metadata,
          ),
        )

      const remove: Interface["remove"] = (input) =>
        locks.withLock(input.sessionID)(
          fs.remove(attachmentDirectory(root, input.sessionID, input.attachmentID), { recursive: true }).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
            Effect.mapError((cause) => storage("remove", cause)),
            Effect.andThen(quota.withPermit(Effect.sync(() => (state.usage = undefined)))),
          ),
        )

      function cleanupAttachment(directory: string, cutoff: number, attachment: FSUtil.DirEntry) {
        const target = path.join(directory, attachment.name)
        function remove() {
          return fs.remove(target, { recursive: true })
        }
        function stored(metadata: Metadata) {
          return !metadata.boundMessageID && metadata.createdAt < cutoff ? remove() : Effect.void
        }
        function partial() {
          function stale(info: FileSystem.File.Info) {
            return Option.getOrElse(info.mtime, () => new Date(0)).getTime() < cutoff ? remove() : Effect.void
          }
          return fs.stat(target).pipe(
            Effect.flatMap(stale),
            Effect.catch(() => Effect.void),
          )
        }
        return readStoredMetadata(path.join(target, metadataName)).pipe(Effect.flatMap(stored), Effect.catch(partial))
      }

      function cleanupSession(input: {
        readonly sessionID: SessionSchema.ID
        readonly directory: string
        readonly orphan: boolean
        readonly cutoff: number
      }) {
        return locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            if (input.orphan) {
              const info = yield* fs.stat(input.directory).pipe(Effect.catch(() => Effect.void))
              const modified = info?.mtime.pipe(
                Option.map((date) => date.getTime()),
                Option.getOrElse(() => 0),
              )
              if (modified !== undefined && modified < input.cutoff)
                yield* fs.remove(input.directory, { recursive: true }).pipe(Effect.catch(() => Effect.void))
              return
            }
            const attachments = yield* fs
              .readDirectoryEntries(input.directory)
              .pipe(Effect.catch(() => Effect.succeed([])))
            yield* Effect.forEach(attachments.filter(directoryEntry), (attachment) =>
              cleanupAttachment(input.directory, input.cutoff, attachment),
            )
          }),
        )
      }

      const cleanup = Effect.fn("AttachmentStore.cleanup")(function* (sessions?: ReadonlySet<SessionSchema.ID>) {
        const cutoff = now() - Duration.toMillis(UNBOUND_RETENTION)
        const roots = yield* fs.readDirectoryEntries(root).pipe(Effect.catch(() => Effect.succeed([])))
        yield* Effect.forEach(
          roots.filter((entry) => entry.type === "directory"),
          (entry) => {
            const decoded = Option.getOrUndefined(Option.liftThrowable(decodeURIComponent)(entry.name))
            if (!decoded || !Schema.is(SessionSchema.ID)(decoded)) return Effect.void
            const sessionID = SessionSchema.ID.make(decoded)
            return cleanupSession({
              sessionID,
              directory: path.join(root, entry.name),
              orphan: sessions !== undefined && !sessions.has(sessionID),
              cutoff,
            })
          },
        )
        yield* quota.withPermit(Effect.sync(() => (state.usage = undefined)))
      })

      return Service.of({ upload, resolve, bind, markNativeMediaDelivered, remove, cleanup })
    }),
  )

export const layerWith = (options: { readonly limits?: Partial<Limits>; readonly now?: () => number } = {}) =>
  makeLayer(options)

const layer = makeLayer()

export const node = Node.tags.make("global")({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node],
})

const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Service
    const { db } = yield* Database.Service
    const cleanup = Effect.gen(function* () {
      const rows = yield* db.select({ id: SessionTable.id }).from(SessionTable).all().pipe(Effect.orDie)
      yield* store.cleanup(new Set(rows.map((row) => SessionSchema.ID.make(row.id))))
    })
    yield* cleanup.pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
  }),
)

export const cleanupNode = Node.tags.make("global")({
  name: "attachment-cleanup",
  layer: cleanupLayer,
  deps: [node, Database.node],
})
