import z from "zod/v4"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { $ } from "bun"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      time: z.object({
        created: z.number(),
        initialized: z.number().optional(),
      }),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  const cache = new Map<string, Info>()
  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })
    const fn = async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (!git) {
        const project: Info = {
          id: "global",
          worktree: "/",
          time: {
            created: Date.now(),
          },
        }
        await Storage.write<Info>(["project", "global"], project)
        return project
      }
      let worktree = path.dirname(git)
      const [id] = await $`git rev-list --max-parents=0 --all`
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
      if (!id) {
        const project: Info = {
          id: "global",
          worktree: "/",
          time: {
            created: Date.now(),
          },
        }
        await Storage.write<Info>(["project", "global"], project)
        return project
      }
      worktree = path.dirname(
        await $`git rev-parse --path-format=absolute --git-common-dir`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) => x.trim()),
      )
      const project: Info = {
        id,
        worktree,
        vcs: "git",
        time: {
          created: Date.now(),
        },
      }
      await Storage.write<Info>(["project", id], project)
      return project
    }
    if (cache.has(directory)) {
      return cache.get(directory)!
    }
    const result = await fn()
    cache.set(directory, result)
    return result
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
}
