export * as Artifact from "./artifact.js"

import { isUtf8 } from "node:buffer"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { and, desc, eq } from "drizzle-orm"
import { lookup } from "mime-types"
import type { ArtifactProviderDefinition, ArtifactPublishInput, ArtifactTarget } from "@opencode/plugin/effect/artifact"
import {
  Binding,
  Capability,
  Content,
  CreateInput,
  Cron,
  Event,
  ID,
  Info,
  Manifest,
  Provider,
  ProviderID,
  UpdateInput,
  Visibility,
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

export { Capability, Content, CreateInput, Event, ID, Info, Manifest, Provider, ProviderID, UpdateInput, Visibility }

export const LocalProviderID = ProviderID.make("local")

export interface ProviderImplementation extends Omit<ArtifactProviderDefinition, "id"> {
  readonly id: ProviderID
}

/** Files by relative path; text is encoded as UTF-8. */
export type Files = Readonly<Record<string, string | Uint8Array>>

/** Where a publish goes, for the caller to approve before the provider uploads anything. */
export interface Target {
  readonly provider: ProviderID
  readonly destination: string
  readonly visibility: Visibility
}

export interface PublishOptions<E> {
  /** Runs before every publish that isn't local, once the provider has accepted what it publishes. */
  readonly authorize?: (target: Target) => Effect.Effect<void, E>
}

export interface UpdateOptions<E> extends PublishOptions<E> {
  /** The files are the whole artifact, so the ones a read leaves out aren't kept. */
  readonly complete?: boolean
}

export interface LocalFile {
  readonly bytes: Uint8Array
  readonly mime: string
}

interface ProviderSummary {
  readonly id: ProviderID
  readonly name: string
  readonly capabilities: readonly Capability[]
  readonly audiences: readonly Visibility[]
}

export interface ProviderPrompts {
  readonly defaultProvider: ProviderSummary & { readonly prompt: string }
  readonly others: readonly ProviderSummary[]
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
  readonly create: <E = never>(
    input: Omit<CreateInput, "files"> & { readonly files: Files },
    options?: PublishOptions<E>,
  ) => Effect.Effect<Info, Error | E>
  readonly get: (
    id: ID,
  ) => Effect.Effect<Content, DisabledError | NotFoundError | ProviderNotFoundError | ProviderError>
  readonly info: (id: ID) => Effect.Effect<Info, DisabledError | NotFoundError>
  readonly update: <E = never>(
    id: ID,
    input: Omit<UpdateInput, "files"> & { readonly files: Files },
    options?: UpdateOptions<E>,
  ) => Effect.Effect<Info, Error | E>
  readonly remove: (
    id: ID,
  ) => Effect.Effect<void, DisabledError | NotFoundError | ProviderNotFoundError | InvalidError | ProviderError>
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
      audiences: ["local"],
      defaultAudience: "local",
      prompt:
        "Artifacts are served as HTML by this OpenCode server under a path of its own, so link assets relatively (./app.js, Vite's base: './'). Only people who can reach this server can open them.",
      destination: () => Effect.succeed("local"),
      create: (input) => Effect.succeed({ url: viewURL(input.id) }),
      update: (id) => Effect.succeed({ url: viewURL(id) }),
      delete: () => Effect.void,
    }

    const snapshotProviders = (data: Data) =>
      Array.from(data.providers.values(), (provider) => ({
        id: provider.id,
        name: provider.name,
        capabilities: provider.capabilities,
        audiences: provider.audiences,
        selection: data.selection,
      })).toSorted((a, b) => a.id.localeCompare(b.id))

    const state = State.create<Data, Editor>({
      initial: () => ({
        providers: new Map([[LocalProviderID, localProvider]]),
      }),
      editor: (draft) => ({
        add: (provider) => {
          // This server's own provider is never replaced, so a plugin can't publish past it without asking.
          if (provider.id === LocalProviderID) return
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

    const call = <A>(provider: ProviderImplementation, effect: Effect.Effect<A, unknown>) =>
      effect.pipe(Effect.mapError((cause) => new ProviderError({ providerID: provider.id, cause })))

    // Checked before any prompt or upload, so a provider never publishes what it can't serve to whom it can't. The
    // providers it suggests need the same audience only when one was chosen.
    const requireSupport = (
      provider: ProviderImplementation,
      needs: readonly Capability[],
      visibility: Visibility,
      chosen: Visibility | undefined,
    ) => {
      const fits = (item: ProviderImplementation, audience: Visibility | undefined) =>
        (audience === undefined || item.audiences.includes(audience)) &&
        needs.every((need) => item.capabilities.includes(need))
      if (fits(provider, visibility)) return Effect.void
      const lacks = [
        ...needs.filter((need) => !provider.capabilities.includes(need)),
        ...(provider.audiences.includes(visibility) ? [] : [`${visibility} artifacts`]),
      ]
      const capable = Array.from(state.get().providers.values()).filter((item) => fits(item, chosen))
      return Effect.fail(
        new InvalidError({
          reason: `Provider ${provider.id} can't publish this artifact: it doesn't support ${lacks.join(", ")}. ${
            capable.length > 0
              ? `Active providers that can: ${capable.map((item) => item.id).join(", ")}.`
              : "No active provider can."
          }`,
          field: "provider",
        }),
      )
    }

    // Saved approvals match destinations as rules, so one with a wildcard would approve more than itself.
    const destinationOf = (provider: ProviderImplementation, target: ArtifactTarget) =>
      call(
        provider,
        provider.destination(target).pipe(
          Effect.filterOrFail(
            (destination) => !/[*?]/.test(destination),
            (destination) => new Error(`Destination ${destination} must not contain * or ?`),
          ),
        ),
      )
    const rowTarget = (row: typeof ArtifactTable.$inferSelect) => ({
      id: row.id,
      title: row.title,
      receipt: row.receipt ?? undefined,
    })

    // An artifact pinned elsewhere, such as another Console workspace or cloud account, is never changed or forgotten
    // from here. One published before destinations were pinned takes the current one only once the provider reads it
    // there.
    const requireDestination = Effect.fnUntraced(function* (
      provider: ProviderImplementation,
      row: typeof ArtifactTable.$inferSelect,
    ) {
      const destination = yield* destinationOf(provider, rowTarget(row))
      if (row.destination === destination) return destination
      const confirmed =
        row.destination === null && provider.read
          ? yield* provider.read(row.id, row.receipt ?? undefined).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            )
          : false
      if (confirmed) return destination
      return yield* new InvalidError({
        reason:
          row.destination === null
            ? `Provider ${provider.id} can't find artifact ${row.id} at ${destination}, so it isn't changed or deleted there.`
            : `Artifact ${row.id} was published to ${row.destination}, but provider ${provider.id} now publishes to ${destination}. Switch back to change or delete it.`,
        field: "provider",
      })
    })

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
            audiences: [...provider.audiences],
            defaultAudience: provider.defaultAudience,
            default: provider.id === defaultID,
          }),
        ).toSorted((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name))
      }),
      prompts: Effect.fn("Artifact.prompts")(function* () {
        const defaultID = activeDefaultID()
        const defaultProvider = state.get().providers.get(defaultID) ?? localProvider
        const summary = (item: ProviderImplementation) => ({
          id: item.id,
          name: item.name,
          capabilities: item.capabilities,
          audiences: item.audiences,
        })
        const others = Array.from(state.get().providers.values())
          .filter((item) => item.id !== defaultProvider.id)
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map(summary)
        return { defaultProvider: { ...summary(defaultProvider), prompt: defaultProvider.prompt }, others }
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
      create: <E = never>(input: Omit<CreateInput, "files"> & { readonly files: Files }, options?: PublishOptions<E>) =>
        Effect.gen(function* () {
          yield* requireEnabled()
          yield* checkSession(input.sessionID)
          const title = input.title.trim()
          if (!title) return yield* new InvalidError({ reason: "Artifact title must not be empty", field: "title" })
          const bundle = yield* readBundle(yield* normalizeFiles(input.files), input.entry)
          const provider = yield* resolveProvider(input.provider)
          const visibility = input.visibility ?? provider.defaultAudience
          yield* requireSupport(provider, bundle.needs, visibility, input.visibility)
          const id = ID.create()
          const destination = yield* destinationOf(provider, { id, title })
          if (provider.id !== LocalProviderID && options?.authorize)
            yield* options.authorize({ provider: provider.id, destination, visibility })
          const now = yield* Clock.currentTimeMillis
          const created = yield* call(
            provider,
            provider.create({ ...bundle.input, id, title, visibility, destination, sessionID: input.sessionID }),
          )
          yield* saveSnapshot(id, bundle.published)
          const row = {
            id,
            project_id: location.project.id,
            session_id: input.sessionID ?? null,
            directory: location.directory,
            provider: provider.id,
            title,
            entry: bundle.input.entry,
            url: created.url ?? viewURL(id),
            visibility,
            destination,
            manifest: bundle.input.manifest,
            receipt: created.receipt ?? null,
            time_created: now,
            time_updated: now,
          }
          yield* db.insert(ArtifactTable).values(row).run().pipe(Effect.orDie)
          return toInfo(row)
        }).pipe(Effect.withSpan("Artifact.create")),
      info: Effect.fn("Artifact.info")(function* (id) {
        yield* requireEnabled()
        return toInfo(yield* requireRecord(id))
      }),
      get: Effect.fn("Artifact.get")(function* (id) {
        yield* requireEnabled()
        const existing = yield* requireRecord(id)
        const provider = state.get().providers.get(existing.provider)
        // A live copy pinned elsewhere is another artifact, so read the snapshot instead.
        const read =
          provider?.read &&
          (existing.destination === null ||
            existing.destination === (yield* destinationOf(provider, rowTarget(existing))))
            ? provider.read
            : undefined
        // An artifact migrated from KV has no snapshot unless its provider was local.
        if (!read && !(yield* snapshotExists(id)))
          return yield* new ProviderNotFoundError({ providerID: existing.provider })
        const snapshot = yield* readDirectoryFiles(itemDir(id))
        // A host serves only public assets, so the live copy replaces those and keeps artifact.json and server files.
        const assets = existing.manifest.assets
        const files = read
          ? yield* read(id, existing.receipt ?? undefined).pipe(
              Effect.mapError((cause) => new ProviderError({ providerID: existing.provider, cause })),
              Effect.map((live) => ({
                ...Object.fromEntries(
                  Object.entries(snapshot).filter(
                    ([filePath]) => manifestFile in snapshot && (assets === undefined || !within(assets, filePath)),
                  ),
                ),
                ...Object.fromEntries(
                  Object.entries(live).map(([filePath, bytes]) => [assets ? `${assets}/${filePath}` : filePath, bytes]),
                ),
              })),
              Effect.tap((refreshed) => saveSnapshot(id, refreshed)),
            )
          : snapshot
        return Content.make({
          info: toInfo(existing),
          ...inlineFiles(files, snapshotEntry(existing)),
          source: read ? "live" : "snapshot",
        })
      }),
      update: <E = never>(
        id: ID,
        input: Omit<UpdateInput, "files"> & { readonly files: Files },
        options?: UpdateOptions<E>,
      ) =>
        Effect.gen(function* () {
          yield* requireEnabled()
          yield* checkSession(input.sessionID)
          const existing = yield* requireRecord(id)
          const title = input.title === undefined ? existing.title : input.title.trim()
          if (!title) return yield* new InvalidError({ reason: "Artifact title must not be empty", field: "title" })
          const supplied = yield* normalizeFiles(input.files)
          // Files a read leaves out (binary, or past its limits) can't be sent back, so they stay unless replaced. Only
          // public assets carry over, and only into the same layout, so a private file never becomes public.
          const previous = options?.complete ? {} : yield* readDirectoryFiles(itemDir(id))
          const omitted = inlineFiles(previous, snapshotEntry(existing)).omitted
          const assets = existing.manifest.assets
          const manifest = supplied[manifestFile]
          const sameLayout =
            manifest === undefined
              ? !(manifestFile in previous)
              : manifestFile in previous && assets !== undefined && (yield* readManifest(manifest)).assets === assets
          const files = {
            ...Object.fromEntries(
              Object.entries(previous).filter(
                ([filePath]) =>
                  sameLayout && filePath in omitted && (assets === undefined || filePath.startsWith(`${assets}/`)),
              ),
            ),
            ...supplied,
          }
          const bundle = yield* readBundle(files, input.entry, existing.entry)
          const provider = yield* resolveProvider(existing.provider)
          // Only a create picks the audience, so an update never publishes wider than the artifact was.
          const visibility = existing.visibility ?? provider.defaultAudience
          yield* requireSupport(provider, bundle.needs, visibility, visibility)
          const destination = yield* requireDestination(provider, existing)
          if (provider.id !== LocalProviderID && options?.authorize)
            yield* options.authorize({ provider: provider.id, destination, visibility })
          const now = yield* Clock.currentTimeMillis
          const sessionID = input.sessionID ?? existing.session_id ?? undefined
          const updated = yield* call(
            provider,
            provider.update(id, {
              ...bundle.input,
              id,
              title,
              visibility,
              destination,
              receipt: existing.receipt ?? undefined,
              sessionID,
            }),
          )
          yield* saveSnapshot(id, bundle.published)
          const changes = {
            session_id: sessionID ?? null,
            title,
            entry: bundle.input.entry,
            url: updated.url ?? existing.url,
            visibility,
            destination,
            manifest: bundle.input.manifest,
            receipt: updated.receipt ?? existing.receipt,
            time_updated: now,
          }
          yield* db.update(ArtifactTable).set(changes).where(eq(ArtifactTable.id, id)).run().pipe(Effect.orDie)
          return toInfo({ ...existing, ...changes })
        }).pipe(Effect.withSpan("Artifact.update")),
      // Keeps the record unless its host deleted the artifact, so it is never lost while the host still serves it.
      remove: Effect.fn("Artifact.remove")(function* (id) {
        yield* requireEnabled()
        const existing = yield* requireRecord(id)
        const provider = yield* resolveProvider(existing.provider)
        yield* requireDestination(provider, existing)
        yield* call(provider, provider.delete(id, existing.receipt ?? undefined))
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
        const target = path.join(itemDir(id), ...(existing.manifest.assets?.split("/") ?? []), ...requested.split("/"))
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

function toInfo(row: typeof ArtifactTable.$inferSelect) {
  return Info.make({
    id: row.id,
    provider: row.provider,
    ...(row.session_id === null ? {} : { sessionID: row.session_id }),
    title: row.title,
    entry: row.entry,
    url: row.url,
    ...(row.visibility === null ? {} : { visibility: row.visibility }),
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

function normalizeFiles(files: Files) {
  return Effect.gen(function* () {
    const entries = Object.entries(files)
    if (entries.length === 0) {
      return yield* new InvalidError({ reason: "Artifact must include at least one file", field: "files" })
    }
    const normalized = new Map<string, Uint8Array>()
    for (const [rawPath, content] of entries) {
      const clean = yield* normalizePath(rawPath)
      normalized.set(clean, typeof content === "string" ? encoder.encode(content) : content)
    }
    return Object.fromEntries(normalized)
  })
}

export const manifestFile = "artifact.json"

const ManifestFile = Schema.fromJsonString(
  Schema.Struct({
    assets: Schema.optional(Schema.String),
    server: Schema.optional(Schema.String),
    spa: Schema.optional(Schema.Boolean),
    bindings: Schema.optional(Schema.Array(Binding)),
    crons: Schema.optional(Schema.Array(Cron)),
  }),
)

/** Reads an artifact.json and the paths it declares: its assets folder, server bundle and migration folders. */
export const readManifest = Effect.fnUntraced(function* (raw: Uint8Array) {
  const declared = yield* Schema.decodeUnknownEffect(ManifestFile)(decoder.decode(raw)).pipe(
    Effect.mapError((error) => new InvalidError({ reason: `Invalid artifact.json: ${error.message}`, field: "files" })),
  )
  return {
    declared,
    assets: declared.assets === undefined ? undefined : yield* normalizePath(declared.assets),
    server: declared.server === undefined ? undefined : yield* normalizePath(declared.server),
    migrations: yield* Effect.forEach(
      (declared.bindings ?? []).flatMap((binding) => binding.migrations ?? []),
      normalizePath,
    ),
  }
})

/**
 * Splits published files into what a provider serves and runs. Without `artifact.json` every file is a public asset.
 * With it, only the `assets` folder is public, the server bundle and migrations go to the provider privately, and
 * every other file stays here.
 */
function readBundle(files: Readonly<Record<string, Uint8Array>>, requested?: string, previous?: string) {
  return Effect.gen(function* () {
    const raw = files[manifestFile]
    if (raw === undefined) {
      const entry = yield* resolveEntry(files, requested ?? (previous && files[previous] ? previous : undefined))
      return bundle(files, entry, { spa: false, bindings: [], crons: [] }, {}, files)
    }
    const { declared, assets, server, migrations } = yield* readManifest(raw)
    if (assets === undefined && server === undefined)
      return yield* invalid("artifact.json must name an assets folder, a server bundle, or both")
    if (server === undefined && ((declared.bindings ?? []).length > 0 || (declared.crons ?? []).length > 0))
      return yield* invalid("artifact.json's bindings and crons need a server bundle")
    const roots = [assets, server, ...migrations, manifestFile].filter((root) => root !== undefined)
    const overlap = roots.flatMap((a, index) =>
      roots.slice(index + 1).flatMap((b) => (within(a, b) || within(b, a) ? [[a, b]] : [])),
    )[0]
    if (overlap)
      return yield* invalid(
        `artifact.json's ${overlap[0]} and ${overlap[1]} overlap; keep assets, server and migrations apart`,
      )
    const entries = Object.entries(files)
    const assetFiles = Object.fromEntries(
      entries.flatMap(([filePath, bytes]) =>
        assets !== undefined && filePath.startsWith(`${assets}/`) ? [[filePath.slice(assets.length + 1), bytes]] : [],
      ),
    )
    if (assets !== undefined && Object.keys(assetFiles).length === 0)
      return yield* invalid(`artifact.json's assets folder ${assets} has no files`)
    if (server !== undefined && files[server] === undefined)
      return yield* invalid(`artifact.json's server bundle ${server} is missing`)
    const empty = migrations.find((root) => !entries.some(([filePath]) => filePath.startsWith(`${root}/`)))
    if (empty !== undefined) return yield* invalid(`artifact.json's migrations folder ${empty} has no files`)
    const serverFiles = Object.fromEntries(
      entries.filter(([filePath]) =>
        [server, ...migrations].some((root) => root !== undefined && within(root, filePath)),
      ),
    )
    const spa = declared.spa ?? false
    if (spa && assetFiles["index.html"] === undefined)
      return yield* invalid(`A single-page app needs ${assets ?? "its assets folder"}/index.html`)
    const entry = spa
      ? "index.html"
      : assets === undefined
        ? (server ?? manifestFile)
        : yield* resolveEntry(assetFiles, requested ?? (previous && assetFiles[previous] ? previous : undefined))
    return bundle(
      assetFiles,
      entry,
      {
        ...(assets === undefined ? {} : { assets }),
        spa,
        ...(server === undefined ? {} : { server }),
        bindings: declared.bindings ?? [],
        crons: declared.crons ?? [],
      },
      serverFiles,
      Object.fromEntries(
        entries.filter(
          ([filePath]) =>
            filePath === manifestFile || (assets !== undefined && within(assets, filePath)) || filePath in serverFiles,
        ),
      ),
    )
  })
}

/** What a provider gets, the capabilities it needs, and the files saved as the snapshot. */
function bundle(
  assets: Readonly<Record<string, Uint8Array>>,
  entry: string,
  manifest: Manifest,
  serverFiles: Readonly<Record<string, Uint8Array>>,
  published: Readonly<Record<string, Uint8Array>>,
) {
  const needs: Capability[] = [
    ...(Object.keys(assets).length > 0 ? (["static"] as const) : []),
    ...(manifest.spa ? (["spa"] as const) : []),
    ...(manifest.server === undefined ? [] : (["server-code"] as const)),
    ...manifest.bindings.map((binding) => binding.kind),
    ...(manifest.crons.length > 0 ? (["cron"] as const) : []),
  ]
  return {
    input: {
      entry,
      manifest,
      assets: Object.fromEntries(
        Object.entries(assets).map(([filePath, bytes]) => [
          filePath,
          { bytes, contentType: detectFileMime(filePath, bytes) },
        ]),
      ),
      serverFiles,
    } satisfies Partial<ArtifactPublishInput>,
    needs: [...new Set(needs)],
    published,
  }
}

const within = (root: string, filePath: string) => filePath === root || filePath.startsWith(`${root}/`)

const invalid = (reason: string) => Effect.fail(new InvalidError({ reason, field: "files" }))

/** The entry's path in the snapshot, which keeps the files' published layout. */
function snapshotEntry(row: typeof ArtifactTable.$inferSelect) {
  return row.manifest.assets === undefined ? row.entry : `${row.manifest.assets}/${row.entry}`
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
