import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { fn } from "../util/fn"
import { Config } from "@/config/config"

export namespace Worktree {
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
      startCommand: z.string().optional(),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

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

  export const create = fn(CreateInput.optional(), async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = path.join(Global.Path.data, "worktree", Instance.project.id)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const info = await candidate(root, base || undefined)

    const created = await $`git worktree add -b ${info.branch} ${info.directory}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
    }

    const cmd = input?.startCommand?.trim()
    if (!cmd) return info

    const ran = await runStartCommand(info.directory, cmd)
    if (ran.exitCode !== 0) {
      throw new StartCommandFailedError({ message: errorText(ran) || "Worktree start command failed" })
    }

    return info
  })
}
