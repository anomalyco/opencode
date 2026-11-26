export * as Artifact from "./artifact.js"

import { isUtf8 } from "node:buffer"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { and, desc, eq } from "drizzle-orm"
import { lookup } from "mime-types"
import {
  Capability,
  Content,
  CreateInput,
  Event,
  ID,
  Info,
  Provider,
  ProviderID,
  UpdateInput,
} from "@opencode/schema/artifact"
import type { SessionID } from "@opencode/schema/session-id"
import { Global } from "@opencode/util/global"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { ArtifactTable } from "./artifact/sql.js"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Flag } from "./flag.js"
import { Location } from "./location.js"
import { Mime } from "./mime.js"
import { Session } from "./session.js"
import { State } from "./state.js"

export { Capability, Content, CreateInput, Event, ID, Info, Provider, ProviderID, UpdateInput }

export const LocalProviderID = ProviderID.make("local")

export interface ProviderCreateInput {
  readonly id: ID
  readonly title: string
  readonly entry: string
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly sessionID?: SessionID
}

export interface ProviderUpdateInput {
  readonly title: string
  readonly entry: string
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly sessionID?: SessionID
}

export interface ProviderResult {
  readonly url?: string
}

export interface ProviderImplementation {
  readonly id: ProviderID
  readonly name: string
  readonly capabilities: readonly Capability[]
  readonly prompt: string
  readonly create: (input: ProviderCreateInput) => Effect.Effect<ProviderResult, unknown>
  /** Reads the live files of a host others edit too. Without it, reads use the snapshot saved at the last publish. */
  readonly read?: (id: ID) => Effect.Effect<Readonly<Record<string, Uint8Array>>, unknown>
  readonly update: (id: ID, input: ProviderUpdateInput) => Effect.Effect<ProviderResult, unknown>
  readonly delete: (id: ID) => Effect.Effect<void, unknown>
}

export interface LocalFile {
  readonly bytes: Uint8Array
  readonly mime: string
}

export interface ProviderPrompts {
  readonly defaultProvider: {
    readonly id: ProviderID
    readonly name: string
    readonly capabilities: readonly Capability[]
    readonly prompt: string
  }
  readonly others: readonly {
    readonly id: ProviderID
    readonly name: string
    readonly capabilities: readonly Capability[]
  }[]
}

export class DisabledError extends Schema.TaggedError<DisabledError>()("Artifact.DisabledError", {}) {
  override get message() {
    return "Artifacts are disabled; set experimental.artifacts in config"
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Artifact.NotFoundError", {
  artifactID: ID,
}) {
  override get message() {
    return `Artifact not found: ${this.artifactID}`
  }
}

export class FileMissingError extends Schema.TaggedError<FileMissingError>()("Artifact.FileMissingError", {
  artifactID: ID,
  path: Schema.String,
}) {
  override get message() {
    return `Artifact file not found: ${this.path}`
  }
}

export class ProviderNotFoundError extends Schema.TaggedError<ProviderNotFoundError>()(
  "Artifact.ProviderNotFoundError",
  {
    providerID: ProviderID,
  },
) {
  override get message() {
    return `Artifact provider not found: ${this.providerID}`
  }
}

export class InvalidError extends Schema.TaggedError<InvalidError>()("Artifact.InvalidError", {
  reason: Schema.String,
  field: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.reason
  }
}

export class ProviderError extends Schema.TaggedError<ProviderError>()("Artifact.ProviderError", {
  providerID: ProviderID,
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.cause instanceof Error && this.cause.message
      ? `Artifact provider ${this.providerID} failed: ${this.cause.message}`
      : `Artifact provider ${this.providerID} failed`
  }
}

export type Error =
  | DisabledError
  | NotFoundError
  | FileMissingError
  | ProviderNotFoundError
  | InvalidError
  | ProviderError
  | Session.NotFoundError

export type Editor = {
  add: (provider: ProviderImplementation) => void
  remove: (id: ProviderID) => void
  default: {
    get: () => ProviderID | undefined
    set: (providerID: ProviderID | undefined) => void
  }
}

type Data = {
  readonly providers: Map<ProviderID, ProviderImplementation>
  selection?: ProviderID
}

export interface Interface extends State.Transformable<Editor> {
  readonly enabled: () => Effect.Effect<boolean>
  readonly providers: () => Effect.Effect<readonly Provider[], DisabledError>
  readonly prompts: () => Effect.Effect<ProviderPrompts>
  readonly list: (filter?: {
    readonly sessionID?: SessionID
    readonly provider?: ProviderID
  }) => Effect.Effect<readonly Info[], DisabledError | Session.NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
  readonly get: (id: ID) => Effect.Effect<Content, DisabledError | NotFoundError | ProviderNotFoundError | ProviderError>
  readonly info: (id: ID) => Effect.Effect<Info, DisabledError | NotFoundError>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, Error>
  readonly remove: (
    id: ID,
  ) => Effect.Effect<void, DisabledError | NotFoundError | ProviderNotFoundError | ProviderError>
  readonly readLocalFile: (
    id: ID,
    subpath?: string,
  ) => Effect.Effect<LocalFile, DisabledError | NotFoundError | FileMissingError | InvalidError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Artifact") {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Resolves the stored directory of an artifact for HTTP routes without an explicit location query. */
export const locate = (database: Database.Interface, id: ID) =>
  database.db
    .select({ directory: ArtifactTable.directory })
    .from(ArtifactTable)
    .where(eq(ArtifactTable.id, id))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.directory),
    )

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const flags = yield* Flag.Service
    const global = yield* Global.Service
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const sessions = yield* Session.Service

    const rootDir = path.join(global.data, "artifacts")
    const itemDir = (id: ID) => path.join(rootDir, id)
    const requireRecord = (id: ID) =>
      db
        .select()
        .from(ArtifactTable)
        .where(and(eq(ArtifactTable.id, id), eq(ArtifactTable.project_id, location.project.id)))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(new NotFoundError({ artifactID: id })))),
        )
    // The last published files of every artifact, whatever its provider.
    const saveSnapshot = (id: ID, files: Readonly<Record<string, Uint8Array>>) =>
      replaceDirectoryFiles(itemDir(id), files).pipe(Effect.orDie)
    const snapshotExists = (id: ID) =>
      Effect.promise(() =>
        fs.stat(itemDir(id)).then(
          () => true,
          () => false,
        ),
      )

    // This server serves the snapshot, so publishing locally has nothing more to do.
    const localProvider: ProviderImplementation = {
      id: LocalProviderID,
      name: "Local",
      capabilities: ["static"],
      prompt:
        "Artifacts are served as HTML by this OpenCode server. Only people who can reach this server can open them.",
      create: (input) => Effect.succeed({ url: viewURL(input.id) }),
      update: (id) => Effect.succeed({ url: viewURL(id) }),
      delete: () => Effect.void,
    }

    const snapshotProviders = (data: Data) =>
      Array.from(data.providers.values(), (provider) => ({
        id: provider.id,
        name: provider.name,
        capabilities: provider.capabilities,
        selection: data.selection,
      })).toSorted((a, b) => a.id.localeCompare(b.id))

    const state = State.create<Data, Editor>({
      initial: () => ({
        providers: new Map([[LocalProviderID, localProvider]]),
      }),
      editor: (draft) => ({
        add: (provider) => {
          draft.providers.set(provider.id, provider)
        },
        remove: (id) => {
          if (id === LocalProviderID) return
          draft.providers.delete(id)
          if (draft.selection === id) draft.selection = undefined
        },
        default: {
          get: () => draft.selection,
          set: (providerID) => {
            draft.selection = providerID
          },
        },
      }),
      notify: State.changes(snapshotProviders, () => bus.publish(Event.Updated, {}).pipe(Effect.asVoid)),
    })

    const isEnabled = Effect.fn("Artifact.enabled")(() => flags.enabled("artifacts"))

    const requireEnabled = () =>
      isEnabled().pipe(Effect.flatMap((on) => (on ? Effect.void : Effect.fail(new DisabledError()))))

    const activeDefaultID = () => {
      const data = state.get()
      return data.selection && data.providers.has(data.selection) ? data.selection : LocalProviderID
    }

    const resolveProvider = (requested?: ProviderID) => {
      const data = state.get()
      const target = requested ?? activeDefaultID()
      const found = data.providers.get(target)
      return found ? Effect.succeed(found) : Effect.fail(new ProviderNotFoundError({ providerID: target }))
    }

    const checkSession = (sessionID?: SessionID) =>
      sessionID === undefined ? Effect.void : sessions.get(sessionID).pipe(Effect.asVoid)

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      enabled: isEnabled,
      providers: Effect.fn("Artifact.providers")(function* () {
        yield* requireEnabled()
        const defaultID = activeDefaultID()
        return Array.from(state.get().providers.values(), (provider) =>
          Provider.make({
            id: provider.id,
            name: provider.name,
            capabilities: [...provider.capabilities],
            default: provider.id === defaultID,
          }),
        ).toSorted((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name))
      }),
      prompts: Effect.fn("Artifact.prompts")(function* () {
        const defaultID = activeDefaultID()
        const defaultProvider = state.get().providers.get(defaultID) ?? localProvider
        const others = Array.from(state.get().providers.values())
          .filter((item) => item.id !== defaultProvider.id)
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ id: item.id, name: item.name, capabilities: item.capabilities }))
        return {
          defaultProvider: {
            id: defaultProvider.id,
            name: defaultProvider.name,
            capabilities: defaultProvider.capabilities,
            prompt: defaultProvider.prompt,
          },
          others,
        }
      }),
      list: Effect.fn("Artifact.list")(function* (filter) {
        yield* requireEnabled()
        if (filter?.sessionID !== undefined) yield* checkSession(filter.sessionID)
        const rows = yield* db
          .select()
          .from(ArtifactTable)
          .where(
            and(
              eq(ArtifactTable.project_id, location.project.id),
              filter?.sessionID === undefined ? undefined : eq(ArtifactTable.session_id, filter.sessionID),
              filter?.provider === undefined ? undefined : eq(ArtifactTable.provider, filter.provider),
            ),
          )
          .orderBy(desc(ArtifactTable.time_updated), desc(ArtifactTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
      create: Effect.fn("Artifact.create")(function* (input) {
        yield* requireEnabled()
        yield* checkSession(input.sessionID)
        const title = input.title.trim()
        if (!title) return yield* new InvalidError({ reason: "Artifact title must not be empty", field: "title" })
        const files = yield* normalizeFiles(encodeStringFiles(input.files))
        const entry = yield* resolveEntry(files, input.entry)
        const provider = yield* resolveProvider(input.provider)
        const id = ID.create()
        const now = yield* Clock.currentTimeMillis
        const created = yield* provider
          .create({ id, title, entry, files, sessionID: input.sessionID })
          .pipe(Effect.mapError((cause) => new ProviderError({ providerID: provider.id, cause })))
        yield* saveSnapshot(id, files)
        const row = {
          id,
          project_id: location.project.id,
          session_id: input.sessionID ?? null,
          directory: location.directory,
          provider: provider.id,
          title,
          entry,
          url: created.url ?? viewURL(id),
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(ArtifactTable).values(row).run().pipe(Effect.orDie)
        return toInfo(row)
      }),
      info: Effect.fn("Artifact.info")(function* (id) {
        yield* requireEnabled()
        return toInfo(yield* requireRecord(id))
      }),
      get: Effect.fn("Artifact.get")(function* (id) {
        yield* requireEnabled()
        const existing = yield* requireRecord(id)
        const read = state.get().providers.get(existing.provider)?.read
        // An artifact migrated from KV has no snapshot unless its provider was local.
        if (!read && !(yield* snapshotExists(id)))
          return yield* new ProviderNotFoundError({ providerID: existing.provider })
        const files = read
          ? yield* read(id).pipe(
              Effect.mapError((cause) => new ProviderError({ providerID: existing.provider, cause })),
              Effect.tap((live) => saveSnapshot(id, live)),
            )
          : yield* readDirectoryFiles(itemDir(id))
        return Content.make({
          info: toInfo(existing),
          ...inlineFiles(files, existing.entry),
          source: read ? "live" : "snapshot",
        })
      }),
      update: Effect.fn("Artifact.update")(function* (id, input) {
        yield* requireEnabled()
        yield* checkSession(input.sessionID)
        const existing = yield* requireRecord(id)
        const title = input.title === undefined ? existing.title : input.title.trim()
        if (!title) return yield* new InvalidError({ reason: "Artifact title must not be empty", field: "title" })
        const supplied = yield* normalizeFiles(encodeStringFiles(input.files))
        // Files a read leaves out (binary, or past its limits) can't be sent back, so they stay unless replaced.
        const previous = yield* readDirectoryFiles(itemDir(id))
        const omitted = inlineFiles(previous, existing.entry).omitted
        const files = {
          ...Object.fromEntries(Object.entries(previous).filter(([filePath]) => filePath in omitted)),
          ...supplied,
        }
        const entry = yield* resolveEntry(files, input.entry ?? (files[existing.entry] ? existing.entry : undefined))
        const provider = yield* resolveProvider(existing.provider)
        const now = yield* Clock.currentTimeMillis
        const sessionID = input.sessionID ?? existing.session_id ?? undefined
        const updated = yield* provider
          .update(id, { title, entry, files, sessionID })
          .pipe(Effect.mapError((cause) => new ProviderError({ providerID: provider.id, cause })))
        yield* saveSnapshot(id, files)
        const changes = {
          session_id: sessionID ?? null,
          title,
          entry,
          url: updated.url ?? existing.url,
          time_updated: now,
        }
        yield* db.update(ArtifactTable).set(changes).where(eq(ArtifactTable.id, id)).run().pipe(Effect.orDie)
        return toInfo({ ...existing, ...changes })
      }),
      // Keeps the record unless its host deleted the artifact, so it is never lost while the host still serves it.
      remove: Effect.fn("Artifact.remove")(function* (id) {
        yield* requireEnabled()
        const existing = yield* requireRecord(id)
        const provider = yield* resolveProvider(existing.provider)
        yield* provider
          .delete(id)
          .pipe(Effect.mapError((cause) => new ProviderError({ providerID: provider.id, cause })))
        yield* Effect.promise(() => fs.rm(itemDir(id), { recursive: true, force: true }))
        yield* db.delete(ArtifactTable).where(eq(ArtifactTable.id, id)).run().pipe(Effect.orDie)
      }),
      readLocalFile: Effect.fn("Artifact.readLocalFile")(function* (id, subpath) {
        yield* requireEnabled()
        const existing = yield* requireRecord(id)
        if (existing.provider !== LocalProviderID) {
          return yield* new InvalidError({
            reason: `Artifact ${id} is hosted by provider "${existing.provider}", not the local server`,
            field: "artifactID",
          })
        }
        const requested = subpath?.trim() ? yield* normalizePath(subpath) : existing.entry
        const target = path.join(itemDir(id), ...requested.split("/"))
        const exists = yield* Effect.promise(() =>
          fs
            .stat(target)
            .then((stat) => stat.isFile())
            .catch(() => false),
        )
        if (!exists) return yield* new FileMissingError({ artifactID: id, path: requested })
        const bytes = yield* Effect.promise(() => fs.readFile(target).then((buf) => new Uint8Array(buf)))
        return { bytes, mime: detectFileMime(requested, bytes) }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, Flag.node, Global.node, Location.node, Session.node],
})

function encodeStringFiles(files: Readonly<Record<string, string>>) {
  return Object.fromEntries(Object.entries(files).map(([filePath, content]) => [filePath, encoder.encode(content)]))
}

function toInfo(row: typeof ArtifactTable.$inferSelect) {
  return Info.make({
    id: row.id,
    provider: row.provider,
    ...(row.session_id === null ? {} : { sessionID: row.session_id }),
    title: row.title,
    entry: row.entry,
    url: row.url,
    time: { created: row.time_created, updated: row.time_updated },
  })
}

/** Inlines UTF-8 text up to 64 KiB a file and 256 KiB in all, entry first, and lists the size of the rest. */
function inlineFiles(files: Readonly<Record<string, Uint8Array>>, entry: string) {
  const content = { files: {} as Record<string, string>, omitted: {} as Record<string, number> }
  let total = 0
  for (const [filePath, bytes] of Object.entries(files).toSorted(
    ([a], [b]) => Number(b === entry) - Number(a === entry) || a.localeCompare(b),
  )) {
    if (bytes.length > 64 * 1024 || total + bytes.length > 256 * 1024 || !isUtf8(bytes)) {
      content.omitted[filePath] = bytes.length
      continue
    }
    content.files[filePath] = decoder.decode(bytes)
    total += bytes.length
  }
  return content
}

function detectFileMime(filePath: string, bytes: Uint8Array) {
  const byName = lookup(filePath)
  if (typeof byName === "string") {
    return byName.startsWith("text/") || byName === "application/javascript" || byName === "application/json"
      ? `${byName}; charset=utf-8`
      : byName
  }
  return Mime.detect(bytes)
}

function normalizePath(raw: string): Effect.Effect<string, InvalidError> {
  const trimmed = raw
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/^\/+/u, "")
  if (!trimmed || trimmed.includes("\0")) {
    return Effect.fail(
      new InvalidError({ reason: `Invalid artifact file path: ${JSON.stringify(raw)}`, field: "files" }),
    )
  }
  const segments = trimmed.split("/")
  if (segments.some((part) => !part || part === "." || part === "..")) {
    return Effect.fail(
      new InvalidError({ reason: `Artifact file path must stay relative: ${JSON.stringify(raw)}`, field: "files" }),
    )
  }
  return Effect.succeed(segments.join("/"))
}

function normalizeFiles(files: Readonly<Record<string, Uint8Array>>) {
  return Effect.gen(function* () {
    const entries = Object.entries(files)
    if (entries.length === 0) {
      return yield* new InvalidError({ reason: "Artifact must include at least one file", field: "files" })
    }
    const normalized = new Map<string, Uint8Array>()
    for (const [rawPath, content] of entries) {
      const clean = yield* normalizePath(rawPath)
      normalized.set(clean, content)
    }
    return Object.fromEntries(normalized)
  })
}

function resolveEntry(files: Readonly<Record<string, Uint8Array>>, requested?: string) {
  if (requested !== undefined) {
    return normalizePath(requested).pipe(
      Effect.flatMap((clean) =>
        files[clean] !== undefined
          ? Effect.succeed(clean)
          : Effect.fail(new InvalidError({ reason: `Entry file not found in files: ${clean}`, field: "entry" })),
      ),
    )
  }
  if (files["index.html"] !== undefined) return Effect.succeed("index.html")
  if (files["index.md"] !== undefined) return Effect.succeed("index.md")
  const keys = Object.keys(files)
  if (keys.length === 1 && keys[0] !== undefined) return Effect.succeed(keys[0])
  return Effect.fail(
    new InvalidError({
      reason: 'Include "index.html" or "index.md", or specify "entry" when publishing multiple files',
      field: "entry",
    }),
  )
}

function viewURL(id: ID) {
  return `/api/experimental/artifacts/${encodeURIComponent(id)}/view/`
}

function replaceDirectoryFiles(baseDir: string, files: Readonly<Record<string, Uint8Array>>) {
  return Effect.tryPromise(async () => {
    const parent = path.dirname(baseDir)
    await fs.mkdir(parent, { recursive: true })
    const nonce = randomUUID()
    const staging = `${baseDir}.staging-${nonce}`
    const backup = `${baseDir}.backup-${nonce}`
    try {
      await fs.mkdir(staging, { recursive: true })
      await Promise.all(
        Object.entries(files).map(async ([rel, bytes]) => {
          const dest = path.join(staging, ...rel.split("/"))
          await fs.mkdir(path.dirname(dest), { recursive: true })
          await fs.writeFile(dest, bytes)
        }),
      )
      const hadExisting = await fs
        .stat(baseDir)
        .then(() => true)
        .catch(() => false)
      if (hadExisting) await fs.rename(baseDir, backup)
      try {
        await fs.rename(staging, baseDir)
      } catch (err) {
        if (hadExisting) await fs.rename(backup, baseDir).catch(() => undefined)
        throw err
      }
      if (hadExisting) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    } catch (err) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw err
    }
  })
}

function readDirectoryFiles(baseDir: string) {
  return Effect.promise(async () => {
    const out: Record<string, Uint8Array> = {}
    const walk = async (current: string, prefix: string): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      await Promise.all(
        entries.map(async (entry) => {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) return walk(full, rel)
          if (entry.isFile()) out[rel] = new Uint8Array(await fs.readFile(full))
        }),
      )
    }
    await walk(baseDir, "")
    return out
  })
}
