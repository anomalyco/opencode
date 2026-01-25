import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Project } from "../project/project"
import { Storage } from "../storage/storage"
import { fn } from "../util/fn"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })

  export const Event = {
    Ready: BusEvent.define(
      "worktree.ready",
      z.object({
        name: z.string(),
        branch: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "worktree.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z
        .string()
        .optional()
        .describe("Additional startup script to run after the project's start command"),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  export const RemoveInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeRemoveInput",
    })

  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeResetInput",
    })

  export type ResetInput = z.infer<typeof ResetInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const RemoveFailedError = NamedError.create(
    "WorktreeRemoveFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const ResetFailedError = NamedError.create(
    "WorktreeResetFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  async function candidate(root: string, base?: string) {
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
      const branch = `opencode/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
      if (branchCheck.exitCode === 0) continue

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    return $`bash -lc ${cmd}`.nothrow().cwd(directory)
  }

  type StartKind = "project" | "worktree"

  async function runStartScript(directory: string, cmd: string, kind: StartKind) {
    const text = cmd.trim()
    if (!text) return true

    const ran = await runStartCommand(directory, text)
    if (ran.exitCode === 0) return true

    log.error("worktree start command failed", {
      kind,
      directory,
      message: errorText(ran),
    })
    return false
  }

  async function runStartScripts(directory: string, input: { projectID: string; extra?: string }) {
    const project = await Storage.read<Project.Info>(["project", input.projectID]).catch(() => undefined)
    const startup = project?.commands?.start?.trim() ?? ""
    const ok = await runStartScript(directory, startup, "project")
    if (!ok) return false

    const extra = input.extra ?? ""
    await runStartScript(directory, extra, "worktree")
    return true
  }

  function queueStartScripts(directory: string, input: { projectID: string; extra?: string }) {
    setTimeout(() => {
      const start = async () => {
        await runStartScripts(directory, input)
      }

      void start().catch((error) => {
        log.error("worktree start task failed", { directory, error })
      })
    }, 0)
  }

  export const create = fn(CreateInput.optional(), async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = path.join(Global.Path.data, "worktree", Instance.project.id)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const info = await candidate(root, base || undefined)

    const created = await $`git worktree add --no-checkout -b ${info.branch} ${info.directory}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
    }

    await Project.addSandbox(Instance.project.id, info.directory).catch(() => undefined)

    const projectID = Instance.project.id
    const extra = input?.startCommand?.trim()
    setTimeout(() => {
      const start = async () => {
        const populated = await $`git reset --hard`.quiet().nothrow().cwd(info.directory)
        if (populated.exitCode !== 0) {
          const message = errorText(populated) || "Failed to populate worktree"
          log.error("worktree checkout failed", { directory: info.directory, message })
          GlobalBus.emit("event", {
            directory: info.directory,
            payload: {
              type: Event.Failed.type,
              properties: {
                message,
              },
            },
          })
          return
        }

        const booted = await Instance.provide({
          directory: info.directory,
          init: InstanceBootstrap,
          fn: () => undefined,
        })
          .then(() => true)
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            log.error("worktree bootstrap failed", { directory: info.directory, message })
            GlobalBus.emit("event", {
              directory: info.directory,
              payload: {
                type: Event.Failed.type,
                properties: {
                  message,
                },
              },
            })
            return false
          })
        if (!booted) return

        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Ready.type,
            properties: {
              name: info.name,
              branch: info.branch,
            },
          },
        })

        await runStartScripts(info.directory, { projectID, extra })
      }

      void start().catch((error) => {
        log.error("worktree start task failed", { directory: info.directory, error })
      })
    }, 0)

    return info
  })

  export const remove = fn(RemoveInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
    if (list.exitCode !== 0) {
      throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
    }

    const lines = outputText(list.stdout)
      .split("\n")
      .map((line) => line.trim())
    const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])

    const entry = entries.find((item) => item.path && path.resolve(item.path) === directory)
    if (!entry?.path) {
      throw new RemoveFailedError({ message: "Worktree not found" })
    }

    const removed = await $`git worktree remove --force ${entry.path}`.quiet().nothrow().cwd(Instance.worktree)
    if (removed.exitCode !== 0) {
      throw new RemoveFailedError({ message: errorText(removed) || "Failed to remove git worktree" })
    }

    const branch = entry.branch?.replace(/^refs\/heads\//, "")
    if (branch) {
      const deleted = await $`git branch -D ${branch}`.quiet().nothrow().cwd(Instance.worktree)
      if (deleted.exitCode !== 0) {
        throw new RemoveFailedError({ message: errorText(deleted) || "Failed to delete worktree branch" })
      }
    }

    return true
  })

  export const reset = fn(ResetInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    if (directory === path.resolve(Instance.worktree)) {
      throw new ResetFailedError({ message: "Cannot reset the primary workspace" })
    }

    const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
    if (list.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(list) || "Failed to read git worktrees" })
    }

    const lines = outputText(list.stdout)
      .split("\n")
      .map((line) => line.trim())
    const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])

    const entry = entries.find((item) => item.path && path.resolve(item.path) === directory)
    if (!entry?.path) {
      throw new ResetFailedError({ message: "Worktree not found" })
    }

    const remoteList = await $`git remote`.quiet().nothrow().cwd(Instance.worktree)
    if (remoteList.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(remoteList) || "Failed to list git remotes" })
    }

    const remotes = outputText(remoteList.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    const remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes("upstream")
          ? "upstream"
          : ""

    const remoteHead = remote
      ? await $`git symbolic-ref refs/remotes/${remote}/HEAD`.quiet().nothrow().cwd(Instance.worktree)
      : { exitCode: 1, stdout: undefined, stderr: undefined }

    const remoteRef = remoteHead.exitCode === 0 ? outputText(remoteHead.stdout) : ""
    const remoteTarget = remoteRef ? remoteRef.replace(/^refs\/remotes\//, "") : ""
    const remoteBranch = remote && remoteTarget.startsWith(`${remote}/`) ? remoteTarget.slice(`${remote}/`.length) : ""

    const mainCheck = await $`git show-ref --verify --quiet refs/heads/main`.quiet().nothrow().cwd(Instance.worktree)
    const masterCheck = await $`git show-ref --verify --quiet refs/heads/master`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    const localBranch = mainCheck.exitCode === 0 ? "main" : masterCheck.exitCode === 0 ? "master" : ""

    const target = remoteBranch ? `${remote}/${remoteBranch}` : localBranch
    if (!target) {
      throw new ResetFailedError({ message: "Default branch not found" })
    }

    if (remoteBranch) {
      const fetch = await $`git fetch ${remote} ${remoteBranch}`.quiet().nothrow().cwd(Instance.worktree)
      if (fetch.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(fetch) || `Failed to fetch ${target}` })
      }
    }

    if (!entry.path) {
      throw new ResetFailedError({ message: "Worktree path not found" })
    }

    const worktreePath = entry.path

    const resetToTarget = await $`git reset --hard ${target}`.quiet().nothrow().cwd(worktreePath)
    if (resetToTarget.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(resetToTarget) || "Failed to reset worktree to target" })
    }

    const clean = await $`git clean -fdx`.quiet().nothrow().cwd(worktreePath)
    if (clean.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(clean) || "Failed to clean worktree" })
    }

    const update = await $`git submodule update --init --recursive --force`.quiet().nothrow().cwd(worktreePath)
    if (update.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(update) || "Failed to update submodules" })
    }

    const subReset = await $`git submodule foreach --recursive git reset --hard`.quiet().nothrow().cwd(worktreePath)
    if (subReset.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(subReset) || "Failed to reset submodules" })
    }

    const subClean = await $`git submodule foreach --recursive git clean -fdx`.quiet().nothrow().cwd(worktreePath)
    if (subClean.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(subClean) || "Failed to clean submodules" })
    }

    const status = await $`git status --porcelain=v1`.quiet().nothrow().cwd(worktreePath)
    if (status.exitCode !== 0) {
      throw new ResetFailedError({ message: errorText(status) || "Failed to read git status" })
    }

    const dirty = outputText(status.stdout)
    if (dirty) {
      throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
    }

    const projectID = Instance.project.id
    queueStartScripts(worktreePath, { projectID })

    return true
  })
}
