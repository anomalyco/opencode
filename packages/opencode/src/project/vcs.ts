import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { git } from "@/util/git"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  const text = (input: Uint8Array | undefined) => {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  const Worktree = z.object({
    path: z.string(),
    branch: z.string().optional(),
    head: z.string().optional(),
    bare: z.boolean().optional(),
    detached: z.boolean().optional(),
    locked: z.string().optional(),
    prunable: z.string().optional(),
  })

  export const Info = z
    .object({
      branch: z.string(),
      branches: z.array(z.string()).default([]),
      worktrees: z.array(Worktree).default([]),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  async function currentBranch() {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return
    const text = result.text().trim()
    if (!text) return
    return text
  }

  async function branchList() {
    const result = await git(["branch", "--format=%(refname:short)"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return []
    return text(result.stdout)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .toSorted()
  }

  async function worktreeList() {
    const result = await git(["worktree", "list", "--porcelain"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return []

    const rows = text(result.stdout).split("\n")
    const out: Info["worktrees"] = []
    let item: Info["worktrees"][number] | undefined

    const push = () => {
      if (!item?.path) return
      out.push(item)
      item = undefined
    }

    for (const row of rows) {
      if (!row.trim()) {
        push()
        continue
      }

      const [key, ...rest] = row.split(" ")
      const value = rest.join(" ").trim()

      if (key === "worktree") {
        push()
        item = { path: value }
        continue
      }

      if (!item) continue
      if (key === "branch") item.branch = value.replace(/^refs\/heads\//, "")
      if (key === "HEAD") item.head = value
      if (key === "bare") item.bare = true
      if (key === "detached") item.detached = true
      if (key === "locked") item.locked = value || "true"
      if (key === "prunable") item.prunable = value || "true"
    }

    push()
    return out
  }

  async function snapshot(): Promise<Info> {
    const branch = await currentBranch()
    const [branches, worktrees] = await Promise.all([branchList(), worktreeList()])
    return {
      branch: branch ?? "",
      branches,
      worktrees,
    }
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return {
          branch: async () => undefined,
          info: async () => ({ branch: "", branches: [], worktrees: [] }),
          unsubscribe: undefined,
        }
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
        info: snapshot,
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

  export async function info() {
    return await state().then((s) => s.info())
  }
}
