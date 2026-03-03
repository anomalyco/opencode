import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const PrInfo = z
    .object({
      number: z.number(),
      url: z.string(),
      title: z.string(),
      state: z.enum(["OPEN", "CLOSED", "MERGED"]),
      headRefName: z.string(),
      baseRefName: z.string(),
      isDraft: z.boolean(),
      mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
      reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable().optional(),
      checksState: z.enum(["SUCCESS", "FAILURE", "PENDING"]).nullable().optional(),
      checksUrl: z.string().optional(),
      checksSummary: z
        .object({
          total: z.number(),
          passed: z.number(),
          failed: z.number(),
          pending: z.number(),
          skipped: z.number(),
        })
        .optional(),
      unresolvedCommentCount: z.number().optional(),
      branchDeleteFailed: z.boolean().optional(),
    })
    .meta({ ref: "PrInfo" })
  export type PrInfo = z.infer<typeof PrInfo>

  export const GithubCapability = z
    .object({
      available: z.boolean(),
      authenticated: z.boolean(),
      repo: z.object({ owner: z.string(), name: z.string() }).optional(),
      host: z.string().optional(),
    })
    .meta({ ref: "GithubCapability" })
  export type GithubCapability = z.infer<typeof GithubCapability>

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
    Updated: BusEvent.define(
      "vcs.updated",
      z.object({
        branch: z.string().optional(),
        defaultBranch: z.string().optional(),
        branches: z.array(z.string()).optional(),
        dirty: z.number().optional(),
        pr: PrInfo.optional(),
        github: GithubCapability.optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
      defaultBranch: z.string().optional(),
      branches: z.array(z.string()).optional(),
      dirty: z.number().optional(),
      pr: PrInfo.optional(),
      github: GithubCapability.optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  async function currentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  export async function detectGithubCapability(): Promise<GithubCapability> {
    const cwd = Instance.worktree
    const authCmd = await withTimeout(
      $`gh auth status`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .catch((e) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) })),
      30_000,
    )
    const authText = (authCmd.stdout?.toString() ?? "") + (authCmd.stderr?.toString() ?? "")
    const available = !authText.includes("not found") && !authText.includes("command not found")
    if (!available) {
      return { available: false, authenticated: false }
    }
    const authenticated = authText.includes("Logged in") || authCmd.exitCode === 0
    if (!authenticated) {
      return { available: true, authenticated: false }
    }
    const repoCmd = await withTimeout(
      $`gh repo view --json owner,name,url`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .catch((e) => ({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(String(e)) })),
      30_000,
    )

    let repo: { owner: string; name: string } | undefined
    let host: string | undefined
    if (repoCmd.exitCode !== 0) {
      log.warn("gh repo view failed", { error: repoCmd.stderr.toString() })
    } else {
      try {
        const parsed = JSON.parse(repoCmd.stdout.toString())
        const ownerLogin = typeof parsed.owner === "string" ? parsed.owner : parsed.owner?.login
        if (ownerLogin && parsed.name) {
          repo = { owner: ownerLogin, name: parsed.name }
        }
        if (parsed.url) {
          host = new URL(parsed.url).hostname
        }
      } catch (e) {
        log.warn("gh repo view json parse failed", { error: String(e) })
      }
    }

    return { available: true, authenticated: true, repo, host }
  }

  export async function fetchDefaultBranch(): Promise<string | undefined> {
    const cwd = Instance.worktree
    const result = await $`git rev-parse --abbrev-ref origin/HEAD`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
      .catch(() => "")
    const trimmed = result.trim()
    if (trimmed && !trimmed.includes("fatal") && trimmed !== "origin/HEAD") {
      return trimmed.replace("origin/", "")
    }
    const ghResult = await withTimeout(
      $`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`
        .quiet()
        .nothrow()
        .cwd(cwd)
        .text()
        .catch(() => ""),
      30_000,
    )
    const ghTrimmed = ghResult.trim()
    if (ghTrimmed && !ghTrimmed.includes("error")) {
      return ghTrimmed
    }
    return undefined
  }

  export async function fetchBranches(): Promise<string[]> {
    const cwd = Instance.worktree
    const result = await $`git branch -r --format=${"%(refname:short)"}`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
      .catch(() => "")
    const branches = result
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b && !b.includes("->"))
      .map((b) => b.replace(/^origin\//, ""))
      .filter((b, i, arr) => arr.indexOf(b) === i)
    branches.sort((a, b) => a.localeCompare(b))
    return branches
  }

  async function fetchDirtyCount(): Promise<number> {
    const cwd = Instance.worktree
    const result = await $`git status --porcelain`
      .quiet()
      .nothrow()
      .cwd(cwd)
      .text()
      .catch(() => "")
    return result.split("\n").filter((l) => l.trim()).length
  }

  async function fetchLocalInfo(): Promise<Pick<Info, "branch" | "dirty">> {
    const branch = await currentBranch()
    return { branch: branch ?? "", dirty: branch ? await fetchDirtyCount() : undefined }
  }

  async function fetchRemoteInfo(_branch: string): Promise<Omit<Info, "branch" | "dirty">> {
    const [github, defaultBranch, branches] = await Promise.all([
      detectGithubCapability(),
      fetchDefaultBranch(),
      fetchBranches(),
    ])

    let pr: PrInfo | undefined
    if (github.authenticated) {
      // Dynamic import to avoid circular dependency (pr.ts → vcs.ts)
      const { PR } = await import("./pr")
      pr = await PR.fetchForBranch(github.repo)
    }

    return {
      defaultBranch,
      branches: branches.length > 0 ? branches : undefined,
      pr,
      github,
    }
  }

  async function fetchFullInfo(): Promise<Info> {
    const local = await fetchLocalInfo()
    if (!local.branch) return { branch: "" }
    const remote = await fetchRemoteInfo(local.branch)
    return { ...local, ...remote }
  }

  export async function commit(message: string) {
    const cwd = Instance.worktree
    const add = await $`git add -u`.quiet().nothrow().cwd(cwd)
    if (add.exitCode !== 0) {
      throw new Error("git add failed: " + add.stderr.toString())
    }
    const result = await $`git commit -m ${message}`.quiet().nothrow().cwd(cwd)
    if (result.exitCode !== 0) {
      throw new Error("git commit failed: " + result.stderr.toString())
    }
    await refresh()
  }

  export const POLL_INTERVAL_MS = 120_000
  export const POLL_INTERVAL_NO_PR_MULTIPLIER = 2
  export const LOCAL_DEBOUNCE_MS = 500
  export const REF_DEBOUNCE_MS = 2_000
  export const POLL_JITTER_MS = 10_000

  function isGitRefChange(file: string): boolean {
    return (
      file.endsWith("HEAD") ||
      file.includes(".git/refs/") ||
      file.endsWith("MERGE_HEAD") ||
      file.endsWith("COMMIT_EDITMSG") ||
      file.includes(".git/packed-refs")
    )
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return { info: async () => ({ branch: "" }), refresh: async () => {}, unsubscribe: undefined }
      }
      let current = await fetchFullInfo()
      log.info("initialized", { branch: current.branch, pr: current.pr?.number })

      let localDebounce: ReturnType<typeof setTimeout> | undefined
      let refDebounce: ReturnType<typeof setTimeout> | undefined
      let pollTimer: ReturnType<typeof setTimeout> | undefined
      let hasActivePr = !!current.pr
      let pollIntervalMs = hasActivePr ? POLL_INTERVAL_MS : POLL_INTERVAL_MS * POLL_INTERVAL_NO_PR_MULTIPLIER

      const restartPollTimer = () => {
        if (pollTimer) clearTimeout(pollTimer)

        const scheduleNext = () => {
          pollTimer = setTimeout(
            async () => {
              try {
                await refreshFull()
              } catch (e) {
                log.error("poll refresh failed", { error: e })
              }
              scheduleNext()
            },
            pollIntervalMs + Math.random() * POLL_JITTER_MS,
          )
        }

        scheduleNext()
      }

      const publish = () => {
        Bus.publish(Event.Updated, {
          branch: current.branch,
          defaultBranch: current.defaultBranch,
          branches: current.branches,
          dirty: current.dirty,
          pr: current.pr,
          github: current.github,
        })
      }

      let refreshLock: Promise<void> = Promise.resolve()

      const refreshLocal = async () => {
        refreshLock = refreshLock.then(async () => {
          const local = await fetchLocalInfo()
          const branchChanged = local.branch !== current.branch
          current = { ...current, ...local }
          if (branchChanged) {
            Bus.publish(Event.BranchUpdated, { branch: local.branch })
            // Branch changed — also refresh remote info
            if (local.branch) {
              const remote = await fetchRemoteInfo(local.branch)
              current = { ...current, ...remote }
            }
          }
          publish()
        })
        await refreshLock
      }

      const refreshFull = async () => {
        refreshLock = refreshLock.then(async () => {
          const next = await fetchFullInfo()
          const branchChanged = next.branch !== current.branch
          const prChanged = next.pr?.number !== current.pr?.number
          current = next
          if (branchChanged) {
            Bus.publish(Event.BranchUpdated, { branch: next.branch })
          }

          const hasPr = !!next.pr
          if (hasPr !== hasActivePr || prChanged) {
            hasActivePr = hasPr
            pollIntervalMs = hasActivePr ? POLL_INTERVAL_MS : POLL_INTERVAL_MS * POLL_INTERVAL_NO_PR_MULTIPLIER
            restartPollTimer()
          }

          publish()
        })
        await refreshLock
      }

      const unsubscribeWatcher = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        const file = evt.properties.file
        if (isGitRefChange(file)) {
          // Git ref change (branch switch, commit, etc) — debounce a full refresh
          if (refDebounce) clearTimeout(refDebounce)
          refDebounce = setTimeout(refreshFull, REF_DEBOUNCE_MS)
          return
        }
        // Regular file change — only refresh local (dirty count, branch)
        if (localDebounce) clearTimeout(localDebounce)
        localDebounce = setTimeout(refreshLocal, LOCAL_DEBOUNCE_MS)
      })

      restartPollTimer()

      return {
        info: async () => current,
        refresh: refreshFull,
        unsubscribe: () => {
          unsubscribeWatcher()
          if (localDebounce) clearTimeout(localDebounce)
          if (refDebounce) clearTimeout(refDebounce)
          if (pollTimer) clearTimeout(pollTimer)
        },
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
    return await state().then((s) => s.info().then((i) => i.branch))
  }

  export async function info(): Promise<Info> {
    return await state().then((s) => s.info())
  }

  export async function refresh() {
    const s = await state()
    await s.refresh()
  }
}
