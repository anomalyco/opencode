import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { $ } from "bun"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { Session } from "../session"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const { id, worktree, vcs, oldProjectID } = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (git) {
        let worktree = path.dirname(git)
        // First resolve the actual worktree path before generating ID
        worktree = await $`git rev-parse --show-toplevel`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) => path.resolve(worktree, x.trim()))

        // Get the actual git directory (handles worktrees where .git is a file pointing elsewhere)
        const gitDir = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) => path.resolve(worktree, x.trim()))

        // Detect if this is a linked worktree (gitDir contains .git/worktrees/)
        const isLinkedWorktree = gitDir.includes(".git/worktrees/")

        // Read cached root commit from .git/opencode (backwards compat with old opencode)
        const cachedRootCommit = await Bun.file(path.join(gitDir, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => {})

        // For linked worktrees, also check for cached worktree hash
        const cachedWorktreeHash = isLinkedWorktree
          ? await Bun.file(path.join(gitDir, "opencode-worktree"))
              .text()
              .then((x) => x.trim())
              .catch(() => {})
          : undefined

        // If we have cached values, construct the ID and return early
        if (cachedRootCommit) {
          if (isLinkedWorktree && cachedWorktreeHash) {
            const id = `${cachedRootCommit}|${cachedWorktreeHash}`
            return { id, worktree, vcs: "git", oldProjectID: undefined }
          }
          if (!isLinkedWorktree) {
            return { id: cachedRootCommit, worktree, vcs: "git", oldProjectID: undefined }
          }
        }

        const roots = await $`git rev-list --max-parents=0 --all`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) =>
            x
              .split("\n")
              .filter(Boolean)
              .map((x) => x.trim())
              .toSorted(),
          )
        const rootCommit = roots[0]
        if (!rootCommit)
          return {
            id: "global",
            worktree,
            vcs: "git",
            oldProjectID: undefined,
          }

        // For main worktree: use root commit as ID (backwards compat)
        // For linked worktrees: use root commit + "|" + hash of worktree path
        let id: string
        if (isLinkedWorktree) {
          const worktreeHash = Bun.hash(worktree).toString(16)
          id = `${rootCommit}|${worktreeHash}`
          Bun.file(path.join(gitDir, "opencode-worktree")).write(worktreeHash)
        } else {
          id = rootCommit
        }

        // Write root commit to .git/opencode
        if (!cachedRootCommit) {
          Bun.file(path.join(gitDir, "opencode")).write(rootCommit)
        }

        // No migration needed - main worktree keeps same ID format
        return { id, worktree, vcs: "git", oldProjectID: undefined }
      }

      return {
        id: "global",
        worktree: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
        oldProjectID: undefined,
      }
    })

    let existing = await Storage.read<Info>(["project", id]).catch(() => undefined)
    if (!existing) {
      existing = {
        id,
        worktree,
        vcs: vcs as Info["vcs"],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (id !== "global") {
        await migrateFromGlobal(id, worktree)
        // Migrate from old project ID format (root commit only) to new format (hash of root commit + worktree)
        if (oldProjectID) {
          await migrateSessions(oldProjectID, id, worktree)
        }
      }
    }
    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)
    const result: Info = {
      ...existing,
      worktree,
      vcs: vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    await Storage.write<Info>(["project", id], result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return result
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.url) return
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree,
        absolute: true,
        onlyFiles: true,
        followSymlinks: false,
        dot: false,
      }),
    )
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = file.type || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateFromGlobal(newProjectID: string, worktree: string) {
    const globalProject = await Storage.read<Info>(["project", "global"]).catch(() => undefined)
    if (!globalProject) return

    const globalSessions = await Storage.list(["session", "global"]).catch(() => [])
    if (globalSessions.length === 0) return

    log.info("migrating sessions from global", { newProjectID, worktree, count: globalSessions.length })

    await work(10, globalSessions, async (key) => {
      const sessionID = key[key.length - 1]
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return
      if (session.directory && session.directory !== worktree) return

      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: "global", to: newProjectID })
      await Storage.write(["session", newProjectID, sessionID], session)
      await Storage.remove(key)
    }).catch((error) => {
      log.error("failed to migrate sessions from global to project", { error, projectId: newProjectID })
    })
  }

  async function migrateSessions(oldProjectID: string, newProjectID: string, worktree: string) {
    const oldProject = await Storage.read<Info>(["project", oldProjectID]).catch(() => undefined)
    if (!oldProject) return
    // Only migrate if the old project's worktree matches this worktree
    if (oldProject.worktree !== worktree) return

    const oldSessions = await Storage.list(["session", oldProjectID]).catch(() => [])
    if (oldSessions.length === 0) return

    log.info("migrating sessions", { from: oldProjectID, to: newProjectID, worktree, count: oldSessions.length })

    await work(10, oldSessions, async (key) => {
      const sessionID = key[key.length - 1]
      const session = await Storage.read<Session.Info>(key).catch(() => undefined)
      if (!session) return

      session.projectID = newProjectID
      log.info("migrating session", { sessionID, from: oldProjectID, to: newProjectID })
      await Storage.write(["session", newProjectID, sessionID], session)
      await Storage.remove(key)
    }).catch((error) => {
      log.error("failed to migrate sessions", { error, from: oldProjectID, to: newProjectID })
    })
  }

  export async function setInitialized(projectID: string) {
    await Storage.update<Info>(["project", projectID], (draft) => {
      draft.time.initialized = Date.now()
    })
  }

  export async function list() {
    const keys = await Storage.list(["project"])
    return await Promise.all(keys.map((x) => Storage.read<Info>(x)))
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
    }),
    async (input) => {
      const result = await Storage.update<Info>(["project", input.projectID], (draft) => {
        if (input.name !== undefined) draft.name = input.name
        if (input.icon !== undefined) {
          draft.icon = {
            ...draft.icon,
          }
          if (input.icon.url !== undefined) draft.icon.url = input.icon.url
          if (input.icon.color !== undefined) draft.icon.color = input.icon.color
        }
        draft.time.updated = Date.now()
      })
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: result,
        },
      })
      return result
    },
  )
}
