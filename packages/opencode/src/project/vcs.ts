import { NamedError } from "@opencode-ai/util/error"
import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Process } from "@/util/process"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  export const CommitFailedError = NamedError.create(
    "VcsCommitFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const Github = z
    .object({
      available: z.boolean(),
      authenticated: z.boolean(),
    })
    .meta({
      ref: "VcsGithubCapability",
    })

  export const CommitAction = z.enum(["commit", "push", "pr"]).meta({
    ref: "VcsCommitAction",
  })

  export const CommitInput = z
    .object({
      message: z.string().trim().min(1),
      includeUnstaged: z.boolean().default(true),
      action: CommitAction.default("commit"),
    })
    .meta({
      ref: "VcsCommitInput",
    })

  export const CommitResult = z
    .object({
      ok: z.boolean(),
      url: z.string().optional(),
    })
    .meta({
      ref: "VcsCommitResult",
    })

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
      staged: z.number().int(),
      unstaged: z.number().int(),
      hasRemote: z.boolean(),
      github: Github,
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly branch: () => Effect.Effect<string | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  const text = (buf: Uint8Array) => Buffer.from(buf).toString().trim()

  const current = async () => {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return undefined
    const value = result.text().trim()
    if (!value || value === "HEAD") return undefined
    return value
  }

  const remote = async () => {
    const result = await git(["remote", "get-url", "origin"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return undefined
    const value = result.text().trim()
    return value || undefined
  }

  const changes = async () => {
    const result = await git(["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return { staged: 0, unstaged: 0 }

    return result
      .text()
      .split(/\r?\n/)
      .filter(Boolean)
      .reduce(
        (acc, line) => {
          const x = line[0]
          const y = line[1]
          if (x && x !== " " && x !== "?") acc.staged += 1
          if (y && y !== " ") acc.unstaged += 1
          if (x === "?" && y === "?") acc.unstaged += 1
          return acc
        },
        { staged: 0, unstaged: 0 },
      )
  }

  const parseRemote = (url: string) => {
    const ssh = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/)
    if (ssh) {
      return {
        host: ssh[1],
      }
    }

    const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/)
    if (https) {
      return {
        host: https[1],
      }
    }
  }

  const github = async (url?: string) => {
    const parsed = url ? parseRemote(url) : undefined
    if (!parsed || !parsed.host.toLowerCase().includes("github")) {
      return { available: false, authenticated: false }
    }

    const result = await Process.run(["gh", "auth", "status", "-h", parsed.host], {
      cwd: Instance.worktree,
      stdin: "ignore",
      nothrow: true,
      timeout: 30_000,
    })

    return {
      available: true,
      authenticated: result.code === 0,
    }
  }

  const fail = (message: string): never => {
    throw new CommitFailedError({ message })
  }

  const check = async (cmd: string[], label: string) => {
    const result = await Process.run(cmd, {
      cwd: Instance.worktree,
      stdin: "ignore",
      nothrow: true,
      timeout: 30_000,
    })
    if (result.code === 0) return text(result.stdout)
    fail(`${label}: ${text(result.stderr) || text(result.stdout) || "unknown error"}`)
  }

  const createPr = async (message: string) => {
    const view = await Process.run(["gh", "pr", "view", "--json", "url", "--jq", ".url"], {
      cwd: Instance.worktree,
      stdin: "ignore",
      nothrow: true,
      timeout: 30_000,
    })
    if (view.code === 0) {
      const url = text(view.stdout)
      if (url) return url
    }

    const created = await check(["gh", "pr", "create", "--title", message, "--body", message], "gh pr create failed")
    if (created) return created
    return await check(["gh", "pr", "view", "--json", "url", "--jq", ".url"], "gh pr view failed")
  }

  export async function info(): Promise<Info> {
    const [branch, url, state] = await Promise.all([current(), remote(), changes()])
    return {
      branch: branch ?? "",
      staged: state.staged,
      unstaged: state.unstaged,
      hasRemote: !!url,
      github: await github(url),
    }
  }

  export async function commit(input: z.infer<typeof CommitInput>): Promise<z.infer<typeof CommitResult>> {
    const message = input.message.trim()
    if (!message) fail("Commit message is required")

    if (input.includeUnstaged) {
      await check(["git", "add", "-A"], "git add failed")
    }

    const state = await changes()
    if (state.staged === 0) {
      fail(input.includeUnstaged ? "No changes to commit" : "No staged changes to commit")
    }

    await check(["git", "commit", "-m", message], "git commit failed")

    if (input.action === "commit") {
      return { ok: true }
    }

    const url = await remote()
    if (!url) fail("No git remote configured")

    await check(["git", "push", "-u", "origin", "HEAD"], "git push failed")

    if (input.action === "push") {
      return { ok: true }
    }

    const gh = await github(url)
    if (!gh.available) fail("GitHub pull requests are not available for this repository")
    if (!gh.authenticated) fail("GitHub CLI is not authenticated")

    return {
      ok: true,
      url: await createPr(message),
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let currentBranch: string | undefined

      if (instance.project.vcs === "git") {
        currentBranch = yield* Effect.promise(() => current())
        log.info("initialized", { branch: currentBranch })

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bus.subscribe(
              FileWatcher.Event.Updated,
              Instance.bind(async (evt) => {
                if (!evt.properties.file.endsWith("HEAD")) return
                const next = await current()
                if (next !== currentBranch) {
                  log.info("branch changed", { from: currentBranch, to: next })
                  currentBranch = next
                  Bus.publish(Event.BranchUpdated, { branch: next })
                }
              }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        )
      }

      return Service.of({
        branch: Effect.fn("Vcs.branch")(function* () {
          return currentBranch
        }),
      })
    }),
  )
}
