import z from "zod"
import { and, Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { which } from "../util/which"
import { ProjectID } from "./schema"
import { Effect, Layer, Path, Scope, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { makeRunPromise } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"

export namespace Project {
  const log = Log.create({ service: "project" })

  export const Info = z
    .object({
      id: ProjectID.zod,
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: row.id,
      worktree: row.worktree,
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  export const UpdateInput = z.object({
    projectID: ProjectID.zod,
    name: z.string().optional(),
    icon: Info.shape.icon.optional(),
    commands: Info.shape.commands.optional(),
  })
  export type UpdateInput = z.infer<typeof UpdateInput>

  // ---------------------------------------------------------------------------
  // Effect service
  // ---------------------------------------------------------------------------

  export interface Interface {
    readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
    readonly discover: (input: Info) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Info[]>
    readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
    readonly update: (input: UpdateInput) => Effect.Effect<Info>
    readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
    readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
    readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
    readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
    readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Project") {}

  type GitResult = { code: number; text: string; stderr: string }

  export const layer: Layer.Layer<
    Service,
    never,
    AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

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

      const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
        Effect.sync(() => Database.use(fn))

      const emitUpdated = (data: Info) =>
        Effect.sync(() =>
          GlobalBus.emit("event", {
            payload: { type: Event.Updated.type, properties: data },
          }),
        )

      const fakeVcs = Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS)

      const resolveGitPath = (cwd: string, name: string) => {
        if (!name) return cwd
        name = name.replace(/[\r\n]+$/, "")
        if (!name) return cwd
        name = AppFileSystem.windowsPath(name)
        if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
        return pathSvc.resolve(cwd, name)
      }

      const scope = yield* Scope.Scope

      const readCachedProjectId = Effect.fnUntraced(function* (dir: string) {
        return yield* fsys.readFileString(pathSvc.join(dir, "opencode")).pipe(
          Effect.map((x) => x.trim()),
          Effect.map(ProjectID.make),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      })

      const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
        log.info("fromDirectory", { directory })

        // Phase 1: discover git info
        type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

        const data: DiscoveryResult = yield* Effect.gen(function* () {
          const dotgitMatches = yield* fsys.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
          const dotgit = dotgitMatches[0]

          if (!dotgit) {
            return {
              id: ProjectID.global,
              worktree: "/",
              sandbox: "/",
              vcs: fakeVcs,
            }
          }

          let sandbox = pathSvc.dirname(dotgit)
          const gitBinary = yield* Effect.sync(() => which("git"))
          let id = yield* readCachedProjectId(dotgit)

          if (!gitBinary) {
            return {
              id: id ?? ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }

          const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
          if (commonDir.code !== 0) {
            return {
              id: id ?? ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }
          const worktree = (() => {
            const common = resolveGitPath(sandbox, commonDir.text.trim())
            return common === sandbox ? sandbox : pathSvc.dirname(common)
          })()

          if (id == null) {
            id = yield* readCachedProjectId(pathSvc.join(worktree, ".git"))
          }

          if (!id) {
            const revList = yield* git(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
            const roots = revList.text
              .split("\n")
              .filter(Boolean)
              .map((x) => x.trim())
              .toSorted()

            id = roots[0] ? ProjectID.make(roots[0]) : undefined
            if (id) {
              yield* fsys.writeFileString(pathSvc.join(worktree, ".git", "opencode"), id).pipe(Effect.ignore)
            }
          }

          if (!id) {
            return { id: ProjectID.global, worktree: sandbox, sandbox, vcs: "git" as const }
          }

          const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
          if (topLevel.code !== 0) {
            return {
              id,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }
          sandbox = resolveGitPath(sandbox, topLevel.text.trim())

          return { id, sandbox, worktree, vcs: "git" as const }
        })

        // Phase 2: upsert
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
        const existing = row
          ? fromRow(row)
          : {
              id: data.id,
              worktree: data.worktree,
              vcs: data.vcs,
              sandboxes: [] as string[],
              time: { created: Date.now(), updated: Date.now() },
            }

        if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY)
          yield* discover(existing).pipe(Effect.ignore, Effect.forkIn(scope))

        const result: Info = {
          ...existing,
          worktree: data.worktree,
          vcs: data.vcs,
          time: { ...existing.time, updated: Date.now() },
        }
        if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
          result.sandboxes.push(data.sandbox)
        result.sandboxes = yield* Effect.forEach(
          result.sandboxes,
          (s) =>
            fsys.exists(s).pipe(
              Effect.orDie,
              Effect.map((exists) => (exists ? s : undefined)),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

        yield* db((d) =>
          d
            .insert(ProjectTable)
            .values({
              id: result.id,
              worktree: result.worktree,
              vcs: result.vcs ?? null,
              name: result.name,
              icon_url: result.icon?.url,
              icon_color: result.icon?.color,
              time_created: result.time.created,
              time_updated: result.time.updated,
              time_initialized: result.time.initialized,
              sandboxes: result.sandboxes,
              commands: result.commands,
            })
            .onConflictDoUpdate({
              target: ProjectTable.id,
              set: {
                worktree: result.worktree,
                vcs: result.vcs ?? null,
                name: result.name,
                icon_url: result.icon?.url,
                icon_color: result.icon?.color,
                time_updated: result.time.updated,
                time_initialized: result.time.initialized,
                sandboxes: result.sandboxes,
                commands: result.commands,
              },
            })
            .run(),
        )

        if (data.id !== ProjectID.global) {
          yield* db((d) =>
            d
              .update(SessionTable)
              .set({ project_id: data.id })
              .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
              .run(),
          )
        }

        yield* emitUpdated(result)
        return { project: result, sandbox: data.sandbox }
      })

      const discover = Effect.fn("Project.discover")(function* (input: Info) {
        if (input.vcs !== "git") return
        if (input.icon?.override) return
        if (input.icon?.url) return

        const matches = yield* fsys
          .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
            cwd: input.worktree,
            absolute: true,
            include: "file",
          })
          .pipe(Effect.orDie)
        const shortest = matches.sort((a, b) => a.length - b.length)[0]
        if (!shortest) return

        const buffer = yield* fsys.readFile(shortest).pipe(Effect.orDie)
        const base64 = Buffer.from(buffer).toString("base64")
        const mime = AppFileSystem.mimeType(shortest)
        const url = `data:${mime};base64,${base64}`
        yield* update({ projectID: input.id, icon: { url } })
      })

      const list = Effect.fn("Project.list")(function* () {
        return yield* db((d) => d.select().from(ProjectTable).all().map(fromRow))
      })

      const get = Effect.fn("Project.get")(function* (id: ProjectID) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        return row ? fromRow(row) : undefined
      })

      const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
        const result = yield* db((d) =>
          d
            .update(ProjectTable)
            .set({
              name: input.name,
              icon_url: input.icon?.url,
              icon_color: input.icon?.color,
              commands: input.commands,
              time_updated: Date.now(),
            })
            .where(eq(ProjectTable.id, input.projectID))
            .returning()
            .get(),
        )
        if (!result) throw new Error(`Project not found: ${input.projectID}`)
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

      const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
        yield* db((d) =>
          d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
        )
      })

      const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) return []
        const data = fromRow(row)
        return yield* Effect.forEach(
          data.sandboxes,
          (dir) =>
            fsys.isDir(dir).pipe(
              Effect.orDie,
              Effect.map((ok) => (ok ? dir : undefined)),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
      })

      const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) throw new Error(`Project not found: ${id}`)
        const sboxes = [...row.sandboxes]
        if (!sboxes.includes(directory)) sboxes.push(directory)
        const result = yield* db((d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        )
        if (!result) throw new Error(`Project not found: ${id}`)
        yield* emitUpdated(fromRow(result))
      })

      const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) throw new Error(`Project not found: ${id}`)
        const sboxes = row.sandboxes.filter((s) => s !== directory)
        const result = yield* db((d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        )
        if (!result) throw new Error(`Project not found: ${id}`)
        yield* emitUpdated(fromRow(result))
      })

      return Service.of({
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

  export const defaultLayer = layer.pipe(
    Layer.provide(CrossSpawnSpawner.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )
  const runPromise = makeRunPromise(Service, defaultLayer)

  // ---------------------------------------------------------------------------
  // Promise-based API (delegates to Effect service via runPromise)
  // ---------------------------------------------------------------------------

  export function fromDirectory(directory: string) {
    return runPromise((svc) => svc.fromDirectory(directory))
  }

  export function discover(input: Info) {
    return runPromise((svc) => svc.discover(input))
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => fromRow(row)),
    )
  }

  export function get(id: ProjectID): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export function setInitialized(id: ProjectID) {
    Database.use((db) =>
      db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
    )
  }

  export function initGit(input: { directory: string; project: Info }) {
    return runPromise((svc) => svc.initGit(input))
  }

  export function update(input: UpdateInput) {
    return runPromise((svc) => svc.update(input))
  }

  export function sandboxes(id: ProjectID) {
    return runPromise((svc) => svc.sandboxes(id))
  }

  export function addSandbox(id: ProjectID, directory: string) {
    return runPromise((svc) => svc.addSandbox(id, directory))
  }

  export function removeSandbox(id: ProjectID, directory: string) {
    return runPromise((svc) => svc.removeSandbox(id, directory))
  }
}
