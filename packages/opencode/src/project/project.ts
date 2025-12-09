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

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number().optional(),
        initialized: z.number().optional(),
      }),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })
    const matches = Filesystem.up({ targets: [".git"], start: directory })
    const git = await matches.next().then((x) => x.value)
    await matches.return()
    if (!git) {
      const project: Info = {
        id: "global",
        worktree: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      await Storage.write<Info>(["project", "global"], project)
      return project
    }
    let worktree = path.dirname(git)
    let id = await Bun.file(path.join(git, "opencode"))
      .text()
      .then((x) => x.trim())
      .catch(() => {})
    if (!id) {
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
      id = roots[0]
      if (id) Bun.file(path.join(git, "opencode")).write(id)
    }
    worktree = await $`git rev-parse --show-toplevel`
      .quiet()
      .nothrow()
      .cwd(worktree)
      .text()
      .then((x) => path.resolve(worktree, x.trim()))
    const projectID = id || "global"
    const existing = id ? await Storage.read<Info>(["project", id]).catch(() => undefined) : undefined
    if (!existing && id) {
      await migrateFromGlobal(projectID, worktree)
    }
    const project: Info = {
      ...existing,
      id: projectID,
      worktree,
      vcs: "git",
      time: {
        created: Date.now(),
        ...existing?.time,
        updated: Date.now(),
      },
    }
    await Storage.write<Info>(["project", projectID], project)
    return project
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
      icon: z.string().optional(),
    }),
    async (input) => {
      return await Storage.update<Info>(["project", input.projectID], (draft) => {
        if (input.name !== undefined) draft.name = input.name
        if (input.icon !== undefined) draft.icon = input.icon
        draft.time.updated = Date.now()
      })
    },
  )
}
