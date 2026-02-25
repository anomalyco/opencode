import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { Database, eq, inArray, sql } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { PermissionTable, SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { git } from "../util/git"
import { EOL } from "os"
import { Glob } from "../util/glob"

export namespace Project {
  const log = Log.create({ service: "project" })

  function gitpath(cwd: string, name: string) {
    if (!name) return cwd
    // git output includes trailing newlines; keep path whitespace intact.
    name = name.replace(/[\r\n]+$/, "")
    if (!name) return cwd

    name = Filesystem.windowsPath(name)

    if (path.isAbsolute(name)) return path.normalize(name)
    return path.resolve(cwd, name)
  }

  export const Info = z
    .object({
      id: z.string(),
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

  function canonical(worktree: string) {
    const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).all())
    if (projects.length === 0) return
    if (projects.length === 1) return projects[0]

    // Prefer git-backed projects when present. Worktrees/sandboxes are a git feature and
    // the split-brain project ID issue only occurs for git repos.
    const gitProjects = projects.filter((p) => p.vcs === "git")
    const pool = gitProjects.length ? gitProjects : projects

    return Database.use((db) =>
      pool
        .map((p) => ({
          p,
          sessions:
            db
              .select({ count: sql<number>`count(*)` })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, p.id))
              .get()?.count ?? 0,
        }))
        .toSorted((a, b) => b.sessions - a.sessions || a.p.time_created - b.p.time_created)[0]?.p,
    )
  }

  function duplicateWorktrees() {
    return Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .groupBy(ProjectTable.worktree)
        // Only repair git-backed duplicates. Sandboxes/worktrees are a git feature.
        .having(sql`sum(case when ${ProjectTable.vcs} = 'git' then 1 else 0 end) > 1`)
        .all()
        .map((x) => x.worktree),
    )
  }

  function cachePath(commonDir: string) {
    return path.join(commonDir, "opencode")
  }

  function merge(existing: Info, dupes: Row[]) {
    return {
      name: existing.name ?? dupes.map((d) => d.name).find(Boolean) ?? undefined,
      commands: existing.commands ?? dupes.map((d) => d.commands).find(Boolean) ?? undefined,
      icon_url: existing.icon?.url ?? dupes.map((d) => d.icon_url).find(Boolean) ?? undefined,
      icon_color: existing.icon?.color ?? dupes.map((d) => d.icon_color).find(Boolean) ?? undefined,
      sandboxes: [...new Set([...existing.sandboxes, ...dupes.flatMap((d) => d.sandboxes)])],
    }
  }

  async function commonDir(worktree: string) {
    if (!Bun.which("git")) return
    const common = await git(["rev-parse", "--git-common-dir"], { cwd: worktree })
      .then((result) => result.text().trim())
      .catch(() => undefined)
    if (!common) return
    return gitpath(worktree, common)
  }

  function writeCache(commonDir: string, id: string) {
    void Bun.file(cachePath(commonDir))
      .write(id)
      .catch(() => undefined)
  }

  async function repairWorktree(worktree: string) {
    const row = canonical(worktree)
    if (!row) return
    if (row.vcs !== "git") return

    const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).all())
    const gitProjects = projects.filter((p) => p.vcs === "git")
    if (gitProjects.length <= 1) return
    const dupes = gitProjects.filter((p) => p.id !== row.id)
    if (dupes.length === 0) return

    const meta = merge(fromRow(row), dupes)
    Database.transaction((db) => {
      const ids = dupes.map((d) => d.id)
      const now = Date.now()

      db.update(SessionTable)
        .set({ project_id: row.id })
        .where(inArray(SessionTable.project_id, ids))
        .run()

      const keep = db.select().from(PermissionTable).where(eq(PermissionTable.project_id, row.id)).get()
      if (!keep) {
        const first = db.select().from(PermissionTable).where(inArray(PermissionTable.project_id, ids)).get()
        if (first) {
          db.insert(PermissionTable)
            .values({
              project_id: row.id,
              data: first.data,
              time_created: now,
              time_updated: now,
            })
            .run()
        }
      }
      db.delete(PermissionTable)
        .where(inArray(PermissionTable.project_id, ids))
        .run()

      db.update(ProjectTable)
        .set({
          name: meta.name,
          icon_url: meta.icon_url,
          icon_color: meta.icon_color,
          commands: meta.commands,
          sandboxes: meta.sandboxes,
          time_updated: now,
        })
        .where(eq(ProjectTable.id, row.id))
        .run()

      db.delete(ProjectTable)
        .where(inArray(ProjectTable.id, ids))
        .run()
    })

    const common = await commonDir(worktree)
    if (common) writeCache(common, row.id)
  }

  export async function repairAll() {
    const worktrees = duplicateWorktrees()
    if (worktrees.length === 0) return
    process.stderr.write(`Found duplicate projects. Creating DB backup...${EOL}`)
    const backup = await Database.backup("project-repair")
    process.stderr.write(`DB backup created at: ${backup}${EOL}`)
    for (const worktree of worktrees) await repairWorktree(worktree)
    process.stderr.write(
      `Duplicate project repair complete. To revert: stop opencode and restore ${backup} (and .bak-wal/.bak-shm if present).${EOL}`,
    )
  }

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

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const data = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()
      if (dotgit) {
        let sandbox = path.dirname(dotgit)

        const gitBinary = Bun.which("git")

        // cached id calculation (fallback for non-git environments)
        let id = await Bun.file(path.join(dotgit, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => undefined)

        if (!gitBinary) {
          return {
            id: id ?? "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // Resolve the worktree root for this directory.
        // NOTE: This must happen before computing a project ID. In worktrees, `.git` can be
        // per-worktree and `git rev-list ...` can observe different refs depending on cwd.
        // Normalizing to the top-level and using the git common dir keeps the computed ID
        // stable across all worktrees for the same repo.
        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then((result) => gitpath(sandbox, result.text()))
          .catch(() => undefined)

        if (!top) {
          return {
            id: id ?? "global",
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        // Resolve the git *common* dir so all worktrees share the same project ID cache.
        const common = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then((result) => result.text().trim())
          .catch(() => undefined)

        if (!common) {
          return {
            id: id ?? "global",
            sandbox,
            worktree: sandbox,
            vcs: "git",
          }
        }

        const commonDir = gitpath(sandbox, common)
        const worktree = path.dirname(commonDir)
        const cacheFile = cachePath(commonDir)

        // NOTE: Cache the project ID in the git *common* dir. In git worktrees `.git` is
        // per-worktree, so caching in `.git/opencode` can cause split-brain project IDs.
        id =
          (await Bun.file(cacheFile)
            .text()
            .then((x) => x.trim())
            .catch(() => undefined)) ?? id

        if (id) writeCache(commonDir, id)

        if (!id) {
          // Generate a stable ID seed for this repo. Using HEAD avoids `--all` ref differences
          // across worktrees while still resolving the same root commit for the repo history.
          const roots = await git(["rev-list", "--max-parents=0", "HEAD"], {
            cwd: sandbox,
            env: {
              // Ensure the git command is evaluated against the common dir, not the worktree.
              GIT_DIR: commonDir,
              GIT_WORK_TREE: sandbox,
            },
          })
            .then((result) => result.text().split("\n").filter(Boolean).map((x) => x.trim()).toSorted())
            .catch(() => undefined)

          id = roots?.[0]
          if (id) {
            await Bun.file(cacheFile)
              .write(id)
              .catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: "global",
            sandbox,
            worktree,
            vcs: "git",
          }
        }

        return {
          id,
          worktree,
          sandbox,
          vcs: "git",
          cache: cacheFile,
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    // If the DB already has a project row for this worktree, reuse it to keep existing
    // sessions/icons/permissions compatible.
    const canonicalRow = data.id === "global" ? undefined : canonical(data.worktree)

    const id = canonicalRow?.id ?? data.id
    if (id !== data.id && data.cache) {
      void Bun.file(data.cache)
        .write(id)
        .catch(() => undefined)
    }

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    const existing = await iife(async () => {
      if (row) return fromRow(row)
      const fresh: Info = {
        id,
        worktree: data.worktree,
        vcs: data.vcs as Info["vcs"],
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (id !== "global") {
        await migrateFromGlobal(id, data.worktree)
      }
      return fresh
    })

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      vcs: data.vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
      result.sandboxes.push(data.sandbox)
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))
    const insert = {
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
    }
    const updateSet = {
      worktree: result.worktree,
      vcs: result.vcs ?? null,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const buffer = await Filesystem.readBytes(shortest)
    const base64 = buffer.toString("base64")
    const mime = Filesystem.mimeType(shortest) || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateFromGlobal(id: string, worktree: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, "global")).get())
    if (!row) return

    const sessions = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.project_id, "global")).all(),
    )
    if (sessions.length === 0) return

    log.info("migrating sessions from global", { newProjectID: id, worktree, count: sessions.length })

    await work(10, sessions, async (row) => {
      // Skip sessions that belong to a different directory
      if (row.directory && row.directory !== worktree) return

      log.info("migrating session", { sessionID: row.id, from: "global", to: id })
      Database.use((db) => db.update(SessionTable).set({ project_id: id }).where(eq(SessionTable.id, row.id)).run())
    }).catch((error) => {
      log.error("failed to migrate sessions from global to project", { error, projectId: id })
    })
  }

  export function setInitialized(id: string) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
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

  export function get(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const result = Database.use((db) =>
        db
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
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export async function sandboxes(id: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const s = Filesystem.stat(dir)
      if (s?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = row.sandboxes.filter((s) => s !== directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
