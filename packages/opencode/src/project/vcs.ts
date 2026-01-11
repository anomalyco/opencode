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
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const BranchInfo = z
    .object({
      name: z.string(),
      current: z.boolean(),
    })
    .meta({
      ref: "BranchInfo",
    })
  export type BranchInfo = z.infer<typeof BranchInfo>

  export const CheckoutInput = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "CheckoutInput",
    })
  export type CheckoutInput = z.infer<typeof CheckoutInput>

  export const CheckoutResult = z
    .object({
      success: z.boolean(),
      branch: z.string(),
      error: z.string().optional(),
    })
    .meta({
      ref: "CheckoutResult",
    })
  export type CheckoutResult = z.infer<typeof CheckoutResult>

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

  export async function branches(limit = 8): Promise<BranchInfo[]> {
    if (Instance.project.vcs !== "git") return []
    const format = "%(refname:short)"
    const result = await $`git branch --sort=-committerdate --format=${format}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .catch(() => "")
    const current = await branch()
    return result
      .split("\n")
      .filter(Boolean)
      .map((x) => x.trim())
      .slice(0, limit)
      .map((name) => ({ name, current: name === current }))
  }

  export async function checkout(branchName: string): Promise<CheckoutResult> {
    if (Instance.project.vcs !== "git") {
      return { success: false, branch: branchName, error: "Not a git repository" }
    }
    const proc = await $`git checkout ${branchName}`.quiet().nothrow().cwd(Instance.worktree)
    if (proc.exitCode !== 0) {
      return { success: false, branch: branchName, error: proc.stderr.toString().trim() }
    }
    Bus.publish(Event.BranchUpdated, { branch: branchName })
    return { success: true, branch: branchName }
  }
}
