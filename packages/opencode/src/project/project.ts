import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { and, eq, ne, sql } from "drizzle-orm"
import { Global } from "@opencode-ai/core/global"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { which } from "@opencode-ai/core/util/which"
import { Hash } from "@opencode-ai/core/util/hash"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { ProjectV2 } from "@opencode-ai/core/project"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/schema/project"

export const Info = Project.Info
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: Project.Event.Updated,
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(Project.Vcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
    repoHash: row.repo_hash ?? undefined,
  }
}

export const UpdateInput = Schema.Struct({
  projectID: ProjectV2.ID,
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
})
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
}).annotate({ identifier: "ProjectUpdateInput" })
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ProjectV2.ID,
}) {}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Per-instance setup. Subscribes to the `/init` slash command for the
   * current instance and stamps the project's initialized timestamp when it
   * fires. Subscription lifetime is tied to the per-instance state scope.
   */
  readonly init: () => Effect.Effect<void>
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectV2.ID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectV2.ID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectV2.ID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectV2.ID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectV2.ID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

type GitResult = { code: number; text: string; stderr: string }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const projectV2 = yield* ProjectV2.Service
    const projectDirectories = yield* ProjectDirectories.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const { db } = yield* Database.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(Project.Vcs))(Flag.OPENCODE_FAKE_VCS)

    const scope = yield* Scope.Scope

    const migrateProjectId = Effect.fn("Project.migrateProjectId")(function* (
      oldID: ProjectV2.ID | undefined,
      newID: ProjectV2.ID,
      worktree: string,
    ) {
      if (!oldID) return
      if (oldID === ProjectV2.ID.global) return
      if (oldID === newID) return

      yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              const oldProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, oldID)).get()
              const newProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, newID)).get()
              if (oldProject && !newProject) {
                yield* d
                  .insert(ProjectTable)
                  .values({
                    ...oldProject,
                    id: newID,
                    // A legacy id may have been shared by several distinct
                    // clones, so the old row's worktree may belong to a
                    // different checkout; the minted identity belongs to the
                    // directory being opened. Sandboxes are cleared for the
                    // same reason and re-validated as directories are opened
                    // (same rationale as the directory clearing below).
                    worktree: AbsolutePath.make(worktree),
                    sandboxes: [],
                    time_updated: Date.now(),
                  })
                  .run()
              }

              // Project directories may be shared across distinct
              // checkouts which have diverged. Clear the directory
              // list and rely on it being re-populated to ensure
              // accuracy
              yield* d.delete(ProjectDirectoryTable).where(eq(ProjectDirectoryTable.project_id, oldID)).run()

              yield* d
                .update(SessionTable)
                .set({ project_id: newID, time_updated: sql`${SessionTable.time_updated}` })
                .where(eq(SessionTable.project_id, oldID))
                .run()
              yield* d
                .update(WorkspaceTable)
                .set({ project_id: newID })
                .where(eq(WorkspaceTable.project_id, oldID))
                .run()

              if (oldProject) yield* d.delete(ProjectTable).where(eq(ProjectTable.id, oldID)).run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)

      // Snapshot and managed-worktree storage are keyed by project id on
      // disk; carry them over so history survives re-identification. Legacy
      // ids can be arbitrary cached file content, so only ids that are plain
      // hash/uuid shapes may be used as a path segment.
      if (/^[0-9a-f-]+$/i.test(oldID)) {
        for (const store of ["snapshot", "worktree"]) {
          yield* fs
            .rename(path.join(Global.Path.data, store, oldID), path.join(Global.Path.data, store, newID))
            .pipe(Effect.ignore)
        }
        // Sessions and workspaces that run inside managed worktrees reference
        // the renamed storage path in their directory column; rewrite them or
        // they point at a dead path after the move above.
        yield* rewriteDirectories(
          newID,
          path.join(Global.Path.data, "worktree", oldID),
          path.join(Global.Path.data, "worktree", newID),
        )
      }
    })

    // Rewrites session and workspace directories recorded at or under `from`
    // to the corresponding path under `to`, scoped to one project. The
    // directory column doubles as the runtime cwd, so rows left pointing at a
    // dead path fail every prompt with ENOENT.
    const rewriteDirectories = Effect.fn("Project.rewriteDirectories")(function* (
      id: ProjectV2.ID,
      from: string,
      to: string,
    ) {
      const prefix = from.endsWith("/") ? from : `${from}/`
      const moved = (directory: string) =>
        directory === from ? to : directory.startsWith(prefix) ? to + directory.slice(from.length) : undefined

      const sessions = yield* db
        .select({ id: SessionTable.id, directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.project_id, id))
        .all()
        .pipe(Effect.orDie)
      for (const session of sessions) {
        const next = moved(session.directory)
        if (!next) continue
        yield* db
          .update(SessionTable)
          .set({ directory: next, time_updated: sql`${SessionTable.time_updated}` })
          .where(eq(SessionTable.id, session.id))
          .run()
          .pipe(Effect.orDie)
      }

      const workspaces = yield* db
        .select({ id: WorkspaceTable.id, directory: WorkspaceTable.directory })
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.project_id, id))
        .all()
        .pipe(Effect.orDie)
      for (const workspace of workspaces) {
        const next = workspace.directory ? moved(workspace.directory) : undefined
        if (!next) continue
        yield* db
          .update(WorkspaceTable)
          .set({ directory: next })
          .where(eq(WorkspaceTable.id, workspace.id))
          .run()
          .pipe(Effect.orDie)
      }
    })

    // When a project's worktree moved on disk (old path dead), everything
    // recorded at or under the old path follows it. The snapshot store is
    // keyed by a hash of the worktree path and is carried over for the same
    // reason. Copies and sibling clones never reach this path — it only runs
    // when the previous worktree no longer exists.
    const rehomeDirectories = Effect.fn("Project.rehomeDirectories")(function* (
      id: ProjectV2.ID,
      from: string,
      to: string,
    ) {
      yield* rewriteDirectories(id, from, to)

      yield* fs
        .rename(
          path.join(Global.Path.data, "snapshot", id, Hash.fast(from)),
          path.join(Global.Path.data, "snapshot", id, Hash.fast(to)),
        )
        .pipe(Effect.ignore)
    })

    const saveProjectDirectory = Effect.fn("Project.saveProjectDirectory")(function* (input: {
      projectID: ProjectV2.ID
      directory: string
    }) {
      if (input.projectID === ProjectV2.ID.global) return
      const opened = AbsolutePath.make(FSUtil.resolve(input.directory))
      yield* projectDirectories
        .create({
          directory: opened,
          projectID: input.projectID,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("project directory persistence failed", { projectID: input.projectID, cause }),
          ),
        )
    })

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      yield* Effect.logInfo("fromDirectory", { directory })

      const data = yield* projectV2.resolve(AbsolutePath.make(directory))
      // A linked worktree's project is rooted at the main checkout, derived
      // from the git common dir. Without this, a repo first contacted through
      // one of its worktrees (e.g. a managed workspace reclaimed after the
      // legacy-id split) would adopt the worktree path as its permanent
      // worktree and later file its real root as a sandbox of itself.
      const mainRoot =
        data.vcs?.type === "git" && path.basename(data.vcs.store) === ".git"
          ? path.dirname(data.vcs.store)
          : data.directory
      const worktree = data.id === ProjectV2.ID.make("global") && !data.vcs ? "/" : mainRoot

      // Phase 2: upsert
      const resolvedID = ProjectV2.ID.make(data.id)
      let projectID = resolvedID
      if (data.vcs?.type === "git" && resolvedID !== ProjectV2.ID.global && !ProjectV2.isStableID(resolvedID)) {
        // Legacy derived ids (remote hash, root commit) collapse independent
        // clones of the same repo into one project. Mint a per-clone identity
        // and persist it to the repo-local cache, which linked worktrees share
        // through the git common dir and which survives folder renames. Only
        // adopt the minted id once it is durably written so a read-only .git
        // does not fragment identity on every boot.
        const minted = ProjectV2.ID.make(crypto.randomUUID())
        const persisted = yield* projectV2.commit({ store: data.vcs.store, id: minted, repoHash: data.repoHash })
        if (persisted) {
          // Re-resolve so concurrent mints for the same repo (e.g. a clone
          // and its linked worktree booting together) converge on whichever
          // identity landed in the cache file.
          const settled = yield* projectV2.resolve(AbsolutePath.make(directory))
          projectID = ProjectV2.isStableID(settled.id) ? ProjectV2.ID.make(settled.id) : minted
          yield* migrateProjectId(resolvedID, projectID, mainRoot)
        }
      }
      if (projectID === resolvedID) {
        // Not minted (already stable, global, or the identity write failed):
        // preserve the legacy cached-id migration.
        yield* migrateProjectId(data.previous ? ProjectV2.ID.make(data.previous) : undefined, projectID, data.directory)
      } else if (data.previous && data.previous !== resolvedID) {
        // Stale cached ids from older schemes follow the mint as well.
        yield* migrateProjectId(ProjectV2.ID.make(data.previous), projectID, mainRoot)
      }
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      const existing = row
        ? fromRow(row)
        : {
            id: projectID,
            worktree,
            vcs: data.vcs?.type ?? fakeVcs,
            sandboxes: [] as string[],
            time: { created: Date.now(), updated: Date.now() },
          }

      if (flags.experimentalIconDiscovery) yield* discover(existing).pipe(Effect.ignore, Effect.forkIn(scope))

      const result: Info = {
        ...existing,
        worktree: projectID === ProjectV2.ID.global ? worktree : existing.worktree,
        vcs: data.vcs?.type ?? fakeVcs,
        time: { ...existing.time, updated: Date.now() },
        repoHash: data.repoHash ?? existing.repoHash,
      }
      if (
        projectID === resolvedID &&
        projectID !== ProjectV2.ID.global &&
        ProjectV2.isStableID(projectID) &&
        data.vcs?.type === "git" &&
        data.repoHash &&
        row?.repo_hash !== data.repoHash
      ) {
        // Keep the repo-local file's grouping key in sync when it is missing
        // or the derivation changed (e.g. a remote was added later). Mint
        // writes it already; this covers already-minted identities.
        yield* projectV2.commit({ store: data.vcs.store, id: projectID, repoHash: data.repoHash })
      }
      if (projectID !== ProjectV2.ID.global && result.worktree !== data.directory) {
        // A renamed or moved clone keeps its identity through the repo-local
        // cache file but leaves the stored worktree pointing at a dead path;
        // adopt the directory it now resolves from.
        const worktreeExists = yield* fs.exists(result.worktree).pipe(Effect.orDie)
        if (!worktreeExists) {
          const previous = result.worktree
          result.worktree = data.directory
          result.sandboxes = result.sandboxes.filter((sandbox) => sandbox !== result.worktree)
          yield* rehomeDirectories(projectID, previous, data.directory)
        }
      }
      if (
        projectID !== ProjectV2.ID.global &&
        data.directory !== result.worktree &&
        !result.sandboxes.includes(data.directory)
      )
        result.sandboxes.push(data.directory)
      result.sandboxes = yield* Effect.forEach(
        result.sandboxes,
        (s) =>
          fs.exists(s).pipe(
            Effect.orDie,
            Effect.map((exists) => (exists ? s : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

      yield* db
        .insert(ProjectTable)
        .values({
          id: result.id,
          worktree: AbsolutePath.make(result.worktree),
          vcs: result.vcs ?? null,
          name: result.name,
          icon_url: result.icon?.url,
          icon_url_override: result.icon?.override,
          icon_color: result.icon?.color,
          time_created: result.time.created,
          time_updated: result.time.updated,
          time_initialized: result.time.initialized,
          sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
          commands: result.commands,
          repo_hash: result.repoHash,
        })
        .onConflictDoUpdate({
          target: ProjectTable.id,
          set: {
            worktree: AbsolutePath.make(result.worktree),
            vcs: result.vcs ?? null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_url_override: result.icon?.override,
            icon_color: result.icon?.color,
            time_updated: result.time.updated,
            time_initialized: result.time.initialized,
            sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
            commands: result.commands,
            repo_hash: result.repoHash,
          },
        })
        .run()
        .pipe(Effect.orDie)

      if (projectID !== ProjectV2.ID.global) {
        // Adopt sessions and workspaces recorded against this exact
        // directory, wherever they are currently parented: global sessions
        // created before the project existed, and rows carried off by a
        // sibling clone that shared a legacy id (whole-project migration
        // moves them in bulk; each clone reclaims its own directory's rows
        // when it is next opened). Exact match only — a nested checkout's
        // rows must stay with the nested project.
        yield* db
          .update(SessionTable)
          .set({ project_id: projectID })
          .where(and(ne(SessionTable.project_id, projectID), eq(SessionTable.directory, data.directory)))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(WorkspaceTable)
          .set({ project_id: projectID })
          .where(and(ne(WorkspaceTable.project_id, projectID), eq(WorkspaceTable.directory, data.directory)))
          .run()
          .pipe(Effect.orDie)
      }

      yield* saveProjectDirectory({
        projectID,
        directory: data.directory,
      })

      yield* emitUpdated(result)
      return { project: result, sandbox: data.vcs ? data.directory : worktree }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = FSUtil.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } }).pipe(
        Effect.catchTag("Project.NotFoundError", () => Effect.void),
      )
    })

    const list = Effect.fn("Project.list")(function* () {
      return (yield* db.select().from(ProjectTable).all().pipe(Effect.orDie)).map(fromRow)
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_url_override: input.icon?.override,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, input.projectID))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) return yield* new NotFoundError({ projectID: input.projectID })
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectV2.ID) {
      yield* db
        .update(ProjectTable)
        .set({ time_initialized: Date.now() })
        .where(eq(ProjectTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    const initState = yield* InstanceState.make(
      Effect.fn("Project.initState")(function* (ctx) {
        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Command.Event.Executed.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Command.Event.Executed>
          return data.name === Command.Default.INIT ? setInitialized(ctx.project.id) : Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
      }),
    )

    const init = Effect.fn("Project.init")(function* () {
      yield* InstanceState.get(initState)
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectV2.ID, directory: string) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandbox = AbsolutePath.make(directory)
      const sboxes = [...row.sandboxes]
      if (!sboxes.includes(sandbox)) sboxes.push(sandbox)
      const result = yield* db
        .update(ProjectTable)
        .set({ sandboxes: sboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectV2.ID, directory: string) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandbox = AbsolutePath.make(directory)
      const sboxes = row.sandboxes.filter((s) => s !== sandbox)
      const result = yield* db
        .update(ProjectTable)
        .set({ sandboxes: sboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      init,
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const use = serviceUse(Service)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    FSUtil.node,
    AppProcess.node,
    CrossSpawnSpawner.node,
    ProjectV2.node,
    ProjectDirectories.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as Project from "./project"
