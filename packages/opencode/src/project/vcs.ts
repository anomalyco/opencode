import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { NamedError } from "@opencode-ai/util/error"
import { fn } from "@/util/fn"

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

  export const Branch = z
    .object({
      name: z.string(),
      remote: z.boolean(),
      worktree: z.string().optional(),
    })
    .meta({
      ref: "VcsBranch",
    })

  export type Branch = z.infer<typeof Branch>

  export const CheckoutInput = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsCheckoutInput",
    })

  export type CheckoutInput = z.infer<typeof CheckoutInput>

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const BranchListFailedError = NamedError.create(
    "VcsBranchListFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const BranchNotFoundError = NamedError.create(
    "VcsBranchNotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export const BranchCheckoutFailedError = NamedError.create(
    "VcsBranchCheckoutFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const output = (value: Uint8Array | undefined) => (value ? Buffer.from(value).toString("utf8") : "")

  const message = (result: { stdout?: Uint8Array; stderr?: Uint8Array }) =>
    [output(result.stderr), output(result.stdout)]
      .map((x) => x.trim())
      .filter(Boolean)
      .join("\n")

  type Worktree = {
    path?: string
    branch?: string
    head?: string
    detached?: boolean
  }

  const parseWorktrees = (value: string) =>
    value
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .reduce<Worktree[]>((all, line) => {
        if (!line.trim()) return all
        if (line.startsWith("worktree ")) {
          all.push({ path: line.slice("worktree ".length) })
          return all
        }
        const item = all[all.length - 1]
        if (!item) return all
        if (line.startsWith("branch refs/heads/")) {
          item.branch = line.slice("branch refs/heads/".length)
          return all
        }
        if (line.startsWith("HEAD ")) {
          item.head = line.slice("HEAD ".length)
          return all
        }
        if (line === "detached") {
          item.detached = true
        }
        return all
      }, [])

  const occupied = (value: string) =>
    parseWorktrees(value).reduce<Map<string, string>>((all, item) => {
      if (!item.path || !item.branch) return all
      all.set(item.branch, item.path)
      return all
    }, new Map())

  const has = async (ref: string) => {
    const result = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
    return result.exitCode === 0
  }

  const upstream = async (name: string) => {
    const result = await $`git for-each-ref --format=%(upstream:short) refs/heads/${name}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (result.exitCode !== 0) return
    const ref = output(result.stdout).trim()
    if (!ref) return
    return ref
  }

  const revision = async (ref: string) => {
    const result = await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) return
    const hash = output(result.stdout).trim()
    if (!hash) return
    return hash
  }

  async function currentBranch() {
    const result = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(Instance.worktree)
    if (result.exitCode !== 0) return
    const branch = output(result.stdout).trim()
    if (!branch) return
    return branch
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return {
          branch: async () => undefined,
          setBranch: (_value: string | undefined) => undefined,
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
        setBranch: (value: string | undefined) => {
          current = value
        },
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

  export async function branches() {
    if (Instance.project.vcs !== "git") return [] as Branch[]

    const [local, remote, worktrees] = await Promise.all([
      $`git branch --list --no-color`.quiet().nothrow().cwd(Instance.worktree),
      $`git branch --remotes --no-color`.quiet().nothrow().cwd(Instance.worktree),
      $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree),
    ])

    if (local.exitCode !== 0) {
      throw new BranchListFailedError({ message: message(local) || "Failed to list local git branches" })
    }

    if (remote.exitCode !== 0) {
      throw new BranchListFailedError({ message: message(remote) || "Failed to list remote git branches" })
    }

    const inuse = new Map<string, string>()
    if (worktrees.exitCode === 0) {
      occupied(output(worktrees.stdout)).forEach((dir, name) => {
        inuse.set(name, dir)
      })
    }

    const current = Instance.worktree
    const localBranches = output(local.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[*+]\s+/, "").trim())
      .filter(Boolean)

    const remoteBranches = output(remote.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.includes(" -> "))

    return [
      ...localBranches.map((name) => {
        const dir = inuse.get(name)
        const worktree = dir && dir !== current ? dir : undefined
        return Branch.parse({ name, remote: false, worktree })
      }),
      ...remoteBranches.map((name) => Branch.parse({ name, remote: true })),
    ].sort((a, b) => {
      if (a.remote !== b.remote) return a.remote ? 1 : -1
      return a.name.localeCompare(b.name)
    })
  }

  export const checkout = fn(CheckoutInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new BranchCheckoutFailedError({ message: "Branch switching is only supported for git projects" })
    }

    const target = input.branch.trim()
    if (!target) {
      throw new BranchCheckoutFailedError({ message: "Branch name is required" })
    }

    const worktrees = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
    const inuse = worktrees.exitCode === 0 ? occupied(output(worktrees.stdout)) : new Map<string, string>()
    const ensureFree = (name: string) => {
      const dir = inuse.get(name)
      if (!dir || dir === Instance.worktree) return
      throw new BranchCheckoutFailedError({
        message: `Branch "${name}" is checked out in another worktree: ${dir}`,
      })
    }

    const current = await currentBranch()
    if (current === target) {
      return Info.parse({ branch: target })
    }

    const local = await has(`refs/heads/${target}`)
    if (local) {
      ensureFree(target)
      const switched = await $`git switch ${target}`.quiet().nothrow().cwd(Instance.worktree)
      if (switched.exitCode !== 0) {
        throw new BranchCheckoutFailedError({
          message: message(switched) || `Failed to switch to ${target}`,
        })
      }

      const next = await currentBranch()
      const branch = next ?? target
      const cache = await state()
      cache.setBranch(branch)
      Bus.publish(Event.BranchUpdated, { branch })
      return Info.parse({ branch })
    }

    const explicit = target.includes("/")
    const remote = explicit ? target : `origin/${target}`
    const remoteRef = `refs/remotes/${remote}`
    const exists = await has(remoteRef)
    if (!exists) {
      throw new BranchNotFoundError({ message: `Branch not found: ${target}` })
    }

    const index = remote.indexOf("/")
    const localName = index >= 0 ? remote.slice(index + 1) : remote
    if (!localName) {
      throw new BranchCheckoutFailedError({ message: `Invalid branch: ${target}` })
    }

    ensureFree(localName)

    const localRef = `refs/heads/${localName}`
    const localExists = await has(localRef)

    if (explicit && localExists) {
      const tracked = await upstream(localName)
      if (tracked && tracked !== remote) {
        throw new BranchCheckoutFailedError({
          message: `Local branch "${localName}" tracks "${tracked}", not "${remote}"`,
        })
      }
      if (!tracked) {
        const [a, b] = await Promise.all([revision(localRef), revision(remoteRef)])
        if (a && b && a !== b) {
          throw new BranchCheckoutFailedError({
            message: `Local branch "${localName}" differs from "${remote}"`,
          })
        }
      }
    }

    const switched = localExists
      ? await $`git switch ${localName}`.quiet().nothrow().cwd(Instance.worktree)
      : await $`git switch --track -c ${localName} ${remote}`.quiet().nothrow().cwd(Instance.worktree)

    if (switched.exitCode !== 0) {
      throw new BranchCheckoutFailedError({
        message: message(switched) || `Failed to switch to ${target}`,
      })
    }

    const next = await currentBranch()
    const branch = next ?? localName
    const cache = await state()
    cache.setBranch(branch)
    Bus.publish(Event.BranchUpdated, { branch })
    return Info.parse({ branch })
  })
}
