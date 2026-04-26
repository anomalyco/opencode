import { Effect, Context, Layer, Schema, Types, Path, SynchronizedRef } from "effect"
import { NodePath } from "@effect/platform-node"
import { Database, eq } from "../storage"
import { MultiRootWorkspaceTable } from "./workspace.sql"
import { MultiRootWorkspaceID } from "./schema"
import { SessionTable } from "../session/session.sql"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Log } from "../util"
import { Global } from "@opencode-ai/core/global"
import { withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"
import { parseWorkspaceFile, serializeWorkspace, type WorkspaceFile } from "./workspace-file"

const log = Log.create({ service: "workspace" })

/** Runtime schema for a workspace info object. */
export const Info = Schema.Struct({
  id: MultiRootWorkspaceID,
  name: Schema.String,
  filePath: Schema.String,
  folders: Schema.Array(Schema.Struct({
    path: Schema.String,
    name: Schema.optional(Schema.String),
  })),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()("WorkspaceNotFoundError", {
  id: MultiRootWorkspaceID,
}) {}

export class WorkspaceDuplicateNameError extends Schema.TaggedErrorClass<WorkspaceDuplicateNameError>()("WorkspaceDuplicateNameError", {
  name: Schema.String,
}) {}

type Row = typeof MultiRootWorkspaceTable.$inferSelect

/** Convert a database row into a workspace Info object. */
export function fromRow(row: Row): Info {
  return {
    id: row.id,
    name: row.name,
    filePath: row.file_path,
    folders: row.folders,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

/** Public interface for the multi-root workspace service. */
export interface Interface {
  /** Create a new workspace with the given name and folders. */
  readonly create: (input: { name: string; folders: Array<{ path: string; name?: string }> }) => Effect.Effect<Info, AppFileSystem.Error | WorkspaceDuplicateNameError>
  /** Open a workspace by ID, syncing folder state from the workspace file. */
  readonly open: (id: MultiRootWorkspaceID) => Effect.Effect<Info | undefined, AppFileSystem.Error>
  /** List all workspaces stored in the database. */
  readonly list: () => Effect.Effect<Info[], AppFileSystem.Error>
  /** Add a folder to an existing workspace. */
  readonly addFolder: (id: MultiRootWorkspaceID, folder: { path: string; name?: string }) => Effect.Effect<Info, WorkspaceNotFoundError | AppFileSystem.Error>
  /** Remove a folder from an existing workspace by its path. */
  readonly removeFolder: (id: MultiRootWorkspaceID, path: string) => Effect.Effect<Info, WorkspaceNotFoundError | AppFileSystem.Error>
  /** Rename a workspace (updates name in DB and renames the on-disk file). */
  readonly rename: (id: MultiRootWorkspaceID, name: string) => Effect.Effect<Info, WorkspaceNotFoundError | WorkspaceDuplicateNameError | AppFileSystem.Error>
  /** Write the current workspace folders to the workspace file on disk. */
  readonly save: (id: MultiRootWorkspaceID) => Effect.Effect<void, WorkspaceNotFoundError | AppFileSystem.Error>
  /** Delete a workspace from the database and remove its file. */
  readonly delete: (id: MultiRootWorkspaceID) => Effect.Effect<void, WorkspaceNotFoundError | AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MultiRootWorkspace") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Path.Path> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path

    const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => Database.use(fn))

    const getWorkspaceFilePath = (name: string) =>
      pathSvc.join(Global.Path.data, "workspaces", `${name}.code-workspace`)

    const ensureWorkspacesDir = Effect.fnUntraced(function* () {
      const dir = pathSvc.join(Global.Path.data, "workspaces")
      const exists = yield* fs.exists(dir)
      if (!exists) {
        yield* fs.makeDirectory(dir, { recursive: true })
      }
      return dir
    })

    const writeWorkspaceFile = Effect.fnUntraced(function* (filePath: string, folders: Array<{ path: string; name?: string }>) {
      const workspace = {
        folders: folders.map(f => ({ path: f.path, name: f.name })),
        settings: {},
      }
      const content = serializeWorkspace(workspace)
      yield* fs.writeFileString(filePath, content)
    })

    const debounceGen = yield* SynchronizedRef.make(new Map<string, number>())

    const debouncedWrite = Effect.fnUntraced(function* (workspaceId: MultiRootWorkspaceID) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, workspaceId)).get()
      )
      if (!row) return
      const filePath = row.file_path

      const genMap = yield* SynchronizedRef.get(debounceGen)
      const gen = (genMap.get(filePath) ?? 0) + 1
      yield* SynchronizedRef.set(debounceGen, new Map(genMap).set(filePath, gen))

      yield* Effect.sleep(500)

      const currentMap = yield* SynchronizedRef.get(debounceGen)
      if (currentMap.get(filePath) !== gen) return

      const latestRow = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, workspaceId)).get()
      )
      if (!latestRow) return
      yield* writeWorkspaceFile(latestRow.file_path, latestRow.folders)
    })

    const sanitizeName = (name: string) => {
      const sanitized = name.trim().replace(/[\\\/:*?"<>|]/g, "_").replace(/\.\./g, "_")
      return sanitized || "workspace"
    }

    const existingNameSet = Effect.fnUntraced(function* () {
      const rows = yield* db((d) => d.select({ name: MultiRootWorkspaceTable.name }).from(MultiRootWorkspaceTable).all())
      return new Set(rows.map((row) => row.name))
    })

    const create = Effect.fn("MultiRootWorkspace.create")(function* (input: { name: string; folders: Array<{ path: string; name?: string }> }) {
      const name = sanitizeName(input.name)
      const collision = yield* db((d) =>
        d.select({ id: MultiRootWorkspaceTable.id })
          .from(MultiRootWorkspaceTable)
          .where(eq(MultiRootWorkspaceTable.name, name))
          .get()
      )
      if (collision) return yield* new WorkspaceDuplicateNameError({ name })

      const id = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())
      const now = Date.now()
      const filePath = getWorkspaceFilePath(name)

      yield* ensureWorkspacesDir()

      const row = yield* db((d) =>
        d.insert(MultiRootWorkspaceTable)
          .values({
            id,
            name,
            file_path: filePath,
            folders: input.folders,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
      )

      yield* writeWorkspaceFile(filePath, input.folders)

      log.info("created workspace", { id, name })
      return fromRow(row)
    })

    const open = Effect.fn("MultiRootWorkspace.open")(function* (id: MultiRootWorkspaceID) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) return undefined

      const content = yield* fs.readFileString(row.file_path)
      const parsed: WorkspaceFile = parseWorkspaceFile(content, row.file_path)

      const foldersFromFile = parsed.folders.map(f => ({ path: f.path, name: f.name }))
      if (JSON.stringify(foldersFromFile) !== JSON.stringify(row.folders)) {
        const now = Date.now()
        yield* db((d) =>
          d.update(MultiRootWorkspaceTable)
            .set({ folders: foldersFromFile, time_updated: now })
            .where(eq(MultiRootWorkspaceTable.id, id))
            .run()
        )
        return fromRow({ ...row, folders: foldersFromFile, time_updated: now })
      }

      return fromRow(row)
    })

    const scanExternalWorkspaces = Effect.fnUntraced(function* () {
      const scanned: Array<{ name: string; filePath: string; folders: Array<{ path: string; name?: string }> }> = []
      const candidates = [
        pathSvc.join(Global.Path.home, ".cursor", "workspaces"),
        pathSvc.join(Global.Path.home, ".vscode", "workspaces"),
        pathSvc.join(Global.Path.home, ".config", "Code", "Workspaces"),
        pathSvc.join(Global.Path.home, "Library", "Application Support", "Cursor", "workspaces"),
        pathSvc.join(Global.Path.home, "Library", "Application Support", "Code", "Workspaces"),
      ]

      for (const dir of candidates) {
        const exists = yield* fs.exists(dir)
        if (!exists) continue
        const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]))
        for (const entry of entries) {
          if (!entry.endsWith(".code-workspace")) continue
          const filePath = pathSvc.join(dir, entry)
          const content = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""))
          if (!content) continue
          try {
            const parsed = parseWorkspaceFile(content, filePath)
            const name = entry.replace(/\.code-workspace$/, "")
            scanned.push({
              name,
              filePath,
              folders: parsed.folders.map(f => ({ path: f.path, name: f.name })),
            })
          } catch (error) {
            log.debug("skipping invalid external workspace file", { path: filePath, error })
          }
        }
      }

      return scanned
    })

    const importExternalWorkspaces = Effect.fnUntraced(function* () {
      const external = yield* scanExternalWorkspaces()
      if (external.length === 0) return

      yield* ensureWorkspacesDir()
      const existingNames = yield* existingNameSet()

      for (const ws of external) {
        const name = sanitizeName(ws.name)
        if (existingNames.has(name)) continue

        const id = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())
        const now = Date.now()
        const filePath = getWorkspaceFilePath(name)
        yield* writeWorkspaceFile(filePath, ws.folders)
        yield* db((d) =>
          d.insert(MultiRootWorkspaceTable)
            .values({
              id,
              name,
              file_path: filePath,
              folders: ws.folders,
              time_created: now,
              time_updated: now,
            })
            .run()
        )
        existingNames.add(name)
        log.info("imported external workspace", { id, name, source: ws.filePath, path: filePath })
      }
    })

    let externalScanDone = false

    const list = Effect.fn("MultiRootWorkspace.list")(function* () {
      if (!externalScanDone) {
        externalScanDone = true
        yield* importExternalWorkspaces().pipe(Effect.orElseSucceed(() => undefined))
      }
      const rows = yield* db((d) => d.select().from(MultiRootWorkspaceTable).all())
      return rows.map(fromRow)
    })

    const addFolder = Effect.fn("MultiRootWorkspace.addFolder")(function* (
      id: MultiRootWorkspaceID,
      folder: { path: string; name?: string }
    ) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) {
        return yield* new WorkspaceNotFoundError({ id })
      }

      const updatedFolders = [...row.folders, folder]
      const now = Date.now()

      const updated = yield* db((d) =>
        d.update(MultiRootWorkspaceTable)
          .set({ folders: updatedFolders, time_updated: now })
          .where(eq(MultiRootWorkspaceTable.id, id))
          .returning()
          .get()
      )

      yield* debouncedWrite(id)

      return fromRow(updated)
    })

    const removeFolder = Effect.fn("MultiRootWorkspace.removeFolder")(function* (
      id: MultiRootWorkspaceID,
      folderPath: string
    ) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) {
        return yield* new WorkspaceNotFoundError({ id })
      }

      const updatedFolders = row.folders.filter(f => f.path !== folderPath)
      const now = Date.now()

      const updated = yield* db((d) =>
        d.update(MultiRootWorkspaceTable)
          .set({ folders: updatedFolders, time_updated: now })
          .where(eq(MultiRootWorkspaceTable.id, id))
          .returning()
          .get()
      )

      yield* debouncedWrite(id)

      return fromRow(updated)
    })

    const rename = Effect.fn("MultiRootWorkspace.rename")(function* (
      id: MultiRootWorkspaceID,
      inputName: string,
    ) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) {
        return yield* new WorkspaceNotFoundError({ id })
      }

      const name = sanitizeName(inputName)
      if (row.name === name) return fromRow(row)

      const collision = yield* db((d) =>
        d.select({ id: MultiRootWorkspaceTable.id })
          .from(MultiRootWorkspaceTable)
          .where(eq(MultiRootWorkspaceTable.name, name))
          .get()
      )
      if (collision && collision.id !== id) {
        return yield* new WorkspaceDuplicateNameError({ name })
      }

      const newFilePath = getWorkspaceFilePath(name)

      const oldGenMap = yield* SynchronizedRef.get(debounceGen)
      const newGenMap = new Map(oldGenMap)
      newGenMap.delete(row.file_path)
      yield* SynchronizedRef.set(debounceGen, newGenMap)

      yield* fs.rename(row.file_path, newFilePath)

      const now = Date.now()
      const updated = yield* db((d) =>
        d.update(MultiRootWorkspaceTable)
          .set({ name, file_path: newFilePath, time_updated: now })
          .where(eq(MultiRootWorkspaceTable.id, id))
          .returning()
          .get()
      )

      log.info("renamed workspace", { id, from: row.name, to: name })
      return fromRow(updated)
    })

    const save = Effect.fn("MultiRootWorkspace.save")(function* (id: MultiRootWorkspaceID) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) {
        return yield* new WorkspaceNotFoundError({ id })
      }

      yield* writeWorkspaceFile(row.file_path, row.folders)
    })

    const delete_ = Effect.fn("MultiRootWorkspace.delete")(function* (id: MultiRootWorkspaceID) {
      const row = yield* db((d) =>
        d.select().from(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).get()
      )

      if (!row) {
        return yield* new WorkspaceNotFoundError({ id })
      }

      const oldGenMap = yield* SynchronizedRef.get(debounceGen)
      const newGenMap = new Map(oldGenMap)
      newGenMap.delete(row.file_path)
      yield* SynchronizedRef.set(debounceGen, newGenMap)

      // Nullify workspace reference on all sessions that point to this workspace
      yield* db((d) =>
        d.update(SessionTable)
          .set({ multi_root_workspace_id: null })
          .where(eq(SessionTable.multi_root_workspace_id, id))
          .run()
      )

      yield* db((d) =>
        d.delete(MultiRootWorkspaceTable).where(eq(MultiRootWorkspaceTable.id, id)).run()
      )

      yield* fs.remove(row.file_path)

      log.info("deleted workspace", { id, name: row.name })
    })

    return Service.of({
      create,
      open,
      list,
      addFolder,
      removeFolder,
      rename,
      save,
      delete: delete_,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export * as MultiRootWorkspace from "./workspace"
