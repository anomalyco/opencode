import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { $ } from "bun"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
    StatusUpdated: BusEvent.define(
      "vcs.status.updated",
      z.object({}),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const FileStatus = z
    .object({
      path: z.string(),
      index: z.string(),
      working: z.string(),
    })
    .meta({
      ref: "VcsFileStatus",
    })
  export type FileStatus = z.infer<typeof FileStatus>

  export const Status = z
    .object({
      staged: FileStatus.array(),
      unstaged: FileStatus.array(),
      untracked: FileStatus.array(),
    })
    .meta({
      ref: "VcsStatus",
    })
  export type Status = z.infer<typeof Status>

  export const CommitInput = z
    .object({
      message: z.string(),
      files: z.string().array().optional(),
    })
    .meta({
      ref: "VcsCommitInput",
    })
  export type CommitInput = z.infer<typeof CommitInput>

  export const CommitResult = z
    .object({
      hash: z.string(),
      message: z.string(),
    })
    .meta({
      ref: "VcsCommitResult",
    })
  export type CommitResult = z.infer<typeof CommitResult>

  async function currentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return { branch: async () => undefined, unsubscribe: undefined }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        if (evt.properties.file.endsWith("HEAD")) return
        const next = await currentBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.BranchUpdated, { branch: next })
        }
      })

      return {
        branch: async () => current,
        unsubscribe,
      }
    },
    async (state) => {
      state.unsubscribe?.()
    },
  )

  export async function init() {
    return state()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function status(): Promise<Status> {
    const output = await $`git status --porcelain=v1`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .catch(() => "")

    const staged: FileStatus[] = []
    const unstaged: FileStatus[] = []
    const untracked: FileStatus[] = []

    for (const line of output.split("\n")) {
      if (!line) continue
      const index = line[0] ?? " "
      const working = line[1] ?? " "
      const filePath = line.slice(3)

      if (index === "?" && working === "?") {
        untracked.push({ path: filePath, index, working })
        continue
      }
      if (index !== " " && index !== "?") {
        staged.push({ path: filePath, index, working })
      }
      if (working !== " " && working !== "?") {
        unstaged.push({ path: filePath, index, working })
      }
    }

    return { staged, unstaged, untracked }
  }

  export async function stage(files: string[]) {
    await $`git add -- ${files}`.quiet().cwd(Instance.worktree)
    Bus.publish(Event.StatusUpdated, {})
  }

  export async function unstage(files: string[]) {
    await $`git reset HEAD -- ${files}`.quiet().nothrow().cwd(Instance.worktree)
    Bus.publish(Event.StatusUpdated, {})
  }

  export async function commit(input: CommitInput): Promise<CommitResult> {
    if (input.files?.length) {
      await $`git add -- ${input.files}`.quiet().cwd(Instance.worktree)
    }
    await $`git commit -m ${input.message}`.quiet().cwd(Instance.worktree)
    const hash = await $`git rev-parse --short HEAD`
      .quiet()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
    Bus.publish(Event.StatusUpdated, {})
    return { hash, message: input.message }
  }

  export async function stash(message?: string) {
    if (message) {
      await $`git stash push -m ${message}`.quiet().cwd(Instance.worktree)
    } else {
      await $`git stash push`.quiet().cwd(Instance.worktree)
    }
    Bus.publish(Event.StatusUpdated, {})
  }

  export async function stashPop() {
    await $`git stash pop`.quiet().cwd(Instance.worktree)
    Bus.publish(Event.StatusUpdated, {})
  }

  export async function push(force?: boolean) {
    if (force) {
      await $`git push --force-with-lease`.quiet().cwd(Instance.worktree)
    } else {
      await $`git push`.quiet().cwd(Instance.worktree)
    }
  }

  export async function diff(file?: string): Promise<string> {
    if (file) {
      return $`git diff -- ${file}`.quiet().nothrow().cwd(Instance.worktree).text()
    }
    return $`git diff`.quiet().nothrow().cwd(Instance.worktree).text()
  }
}
