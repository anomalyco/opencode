import { Octokit } from "@octokit/rest"
import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Process } from "@/util/process"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

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

  const Side = z.enum(["additions", "deletions"])

  export const ReviewComment = z
    .object({
      id: z.string(),
      file: z.string(),
      selection: z.object({
        start: z.number().int().positive(),
        end: z.number().int().positive(),
        side: Side.optional(),
        endSide: Side.optional(),
      }),
      comment: z.string(),
      reviewer: z.string(),
      time: z.number().int().nonnegative(),
    })
    .meta({
      ref: "VcsReviewComment",
    })
  export type ReviewComment = z.infer<typeof ReviewComment>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
  }

  interface State {
    current: string | undefined
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")((ctx) =>
          Effect.gen(function* () {
            if (ctx.project.vcs !== "git") {
              return { current: undefined }
            }

            const getCurrentBranch = async () => {
              const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
                cwd: ctx.worktree,
              })
              if (result.exitCode !== 0) return undefined
              const text = result.text().trim()
              return text || undefined
            }

            const value = {
              current: yield* Effect.promise(() => getCurrentBranch()),
            }
            log.info("initialized", { branch: value.current })

            yield* Effect.acquireRelease(
              Effect.sync(() =>
                Bus.subscribe(
                  FileWatcher.Event.Updated,
                  Instance.bind(async (evt) => {
                    if (!evt.properties.file.endsWith("HEAD")) return
                    const next = await getCurrentBranch()
                    if (next !== value.current) {
                      log.info("branch changed", { from: value.current, to: next })
                      value.current = next
                      Bus.publish(Event.BranchUpdated, { branch: next })
                    }
                  }),
                ),
              ),
              (unsubscribe) => Effect.sync(unsubscribe),
            )

            return value
          }),
        ),
      )

      return Service.of({
        init: Effect.fn("Vcs.init")(function* () {
          yield* InstanceState.get(state)
        }),
        branch: Effect.fn("Vcs.branch")(function* () {
          return yield* InstanceState.use(state, (x) => x.current)
        }),
      })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export function branch() {
    return runPromise((svc) => svc.branch())
  }

  type Repo = {
    owner: string
    repo: string
  }

  type Pull = Repo & {
    number: number
  }

  function parse(url: string) {
    const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (!match) return
    return {
      owner: match[1],
      repo: match[2],
    }
  }

  const side = (input: string | null | undefined) => {
    if (input === "LEFT") return "deletions" as const
    if (input === "RIGHT") return "additions" as const
  }

  const read = async (args: string[]) => {
    const result = await git(args, {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return
    const text = result.text().trim()
    if (!text) return
    return text
  }

  const uniq = (list: string[]) => list.filter((item, i) => list.indexOf(item) === i)

  function dedupe(list: Repo[]) {
    const seen = new Set<string>()
    return list.filter((item) => {
      const key = `${item.owner}/${item.repo}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async function refs(branch: string) {
    const [list, track, push] = await Promise.all([
      read(["remote"]).then((text) => text?.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) ?? []),
      read(["config", "--get", `branch.${branch}.remote`]),
      read(["config", "--get", `branch.${branch}.pushRemote`]),
    ])

    const names = uniq([push, track, "origin", "upstream", ...list].filter((item): item is string => !!item))
    const repos = await Promise.all(
      names.map(async (name) => {
        const url = await read(["remote", "get-url", name])
        if (!url) return
        return parse(url)
      }),
    ).then((list) => list.filter((item): item is Repo => !!item))

    return {
      base: dedupe(repos),
      head: uniq(repos.map((item) => item.owner)),
    }
  }

  async function token() {
    const env = process.env["GITHUB_TOKEN"] || process.env["GH_TOKEN"]
    if (env) return env
    const out = await Process.run(["gh", "auth", "token"], {
      nothrow: true,
    })
    if (out.code !== 0) return
    const text = out.stdout.toString().trim()
    if (!text) return
    return text
  }

  async function pull(octo: Octokit, branch: string) {
    const repo = await refs(branch)
    if (repo.base.length === 0 || repo.head.length === 0) return

    const list = repo.base.flatMap((base) => repo.head.map((head) => ({ base, head })))
    const prs = await Promise.all(
      list.map((item) =>
        octo.rest.pulls
          .list({
            owner: item.base.owner,
            repo: item.base.repo,
            state: "open",
            head: `${item.head}:${branch}`,
            per_page: 1,
          })
          .then((res) => {
            const pr = res.data[0]
            if (!pr) return
            return {
              owner: item.base.owner,
              repo: item.base.repo,
              number: pr.number,
            } satisfies Pull
          })
          .catch(() => undefined),
      ),
    )

    return prs.find((item): item is Pull => !!item)
  }

  export async function reviewComments() {
    const branch = await Vcs.branch()
    if (!branch) return []

    const auth = await token()
    const octo = auth ? new Octokit({ auth }) : new Octokit()
    const pr = await pull(octo, branch)
    if (!pr) return []

    const list = await octo
      .paginate(octo.rest.pulls.listReviewComments, {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        per_page: 100,
      })
      .catch(() => [])

    return list
      .flatMap((item) => {
        if (!item.path) return []
        const line = item.line ?? item.original_line
        if (!line) return []
        const comment = item.body?.trim()
        if (!comment) return []

        const start = item.start_line ?? item.original_start_line ?? line
        const selection = {
          start: Math.min(start, line),
          end: Math.max(start, line),
        } as ReviewComment["selection"]

        const from = side(item.start_side)
        const to = side(item.side)

        if (from) selection.side = from
        if (to) {
          if (!selection.side) selection.side = to
          else if (to !== selection.side) selection.endSide = to
        }

        const time = Date.parse(item.updated_at ?? item.created_at ?? "")

        return [
          {
            id: String(item.id),
            file: item.path,
            selection,
            comment,
            reviewer: item.user?.login ?? "GitHub",
            time: Number.isFinite(time) ? time : 0,
          } satisfies ReviewComment,
        ]
      })
      .sort((a, b) => a.time - b.time)
  }
}
