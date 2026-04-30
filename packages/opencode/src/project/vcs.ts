import { Effect, Layer, ServiceMap, Scope } from "effect"
import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  const count = (text: string) => {
    if (!text) return 0
    if (!text.endsWith("\n")) return text.split("\n").length
    return text.slice(0, -1).split("\n").length
  }

  const work = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, cwd: string, file: string) {
    const full = path.join(cwd, file)
    if (!(yield* fs.exists(full).pipe(Effect.orDie))) return ""
    const buf = yield* fs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
    if (Buffer.from(buf).includes(0)) return ""
    return Buffer.from(buf).toString("utf8")
  })

  const nums = (list: Git.Stat[]) =>
    new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

  const merge = (...lists: Git.Item[][]) => {
    const out = new Map<string, Git.Item>()
    lists.flat().forEach((item) => {
      if (!out.has(item.file)) out.set(item.file, item)
    })
    return [...out.values()]
  }

  const files = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string | undefined,
    list: Git.Item[],
    map: Map<string, { additions: number; deletions: number }>,
  ) {
    const base = ref ? yield* git.prefix(cwd) : ""
    const next = yield* Effect.forEach(
      list,
      (item) =>
        Effect.gen(function* () {
          const before = item.status === "added" || !ref ? "" : yield* git.show(cwd, ref, item.file, base)
          const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
          const stat = map.get(item.file)
          return {
            file: item.file,
            before,
            after,
            additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
            deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
            status: item.status,
          } satisfies Snapshot.FileDiff
        }),
      { concurrency: 8 },
    )
    return next.toSorted((a, b) => a.file.localeCompare(b.file))
  })

  const track = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string | undefined,
  ) {
    if (!ref) return yield* files(fs, git, cwd, ref, yield* git.status(cwd), new Map())
    const [list, stats] = yield* Effect.all([git.status(cwd), git.stats(cwd, ref)], { concurrency: 2 })
    return yield* files(fs, git, cwd, ref, list, nums(stats))
  })

  const compare = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string,
  ) {
    const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
      concurrency: 3,
    })
    return yield* files(
      fs,
      git,
      cwd,
      ref,
      merge(
        list,
        extra.filter((item) => item.code === "??"),
      ),
      nums(stats),
    )
  })

  const branchList = Effect.fnUntraced(function* (git: Git.Interface, cwd: string) {
    const result = yield* git.run(["branch", "--format=%(refname:short)"], { cwd })
    if (result.exitCode !== 0) return []
    return result
      .text()
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .toSorted()
  })

  const worktreeList = Effect.fnUntraced(function* (git: Git.Interface, cwd: string) {
    const result = yield* git.run(["worktree", "list", "--porcelain"], { cwd })
    if (result.exitCode !== 0) return []

    const rows = result.text().split(/\r?\n/)
    const out: Array<z.infer<typeof Worktree>> = []
    let item: z.infer<typeof Worktree> | undefined

    const push = () => {
      if (!item?.path) return
      out.push(item)
      item = undefined
    }

    rows.forEach((row) => {
      if (!row.trim()) {
        push()
        return
      }

      const [key, ...rest] = row.split(" ")
      const value = rest.join(" ").trim()

      if (key === "worktree") {
        push()
        item = { path: value }
        return
      }

      if (!item) return
      if (key === "branch") item.branch = value.replace(/^refs\/heads\//, "")
      if (key === "HEAD") item.head = value
      if (key === "bare") item.bare = true
      if (key === "detached") item.detached = true
      if (key === "locked") item.locked = value || "true"
      if (key === "prunable") item.prunable = value || "true"
    })

    push()
    return out
  })

  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

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
      branch: z.string().optional(),
      default_branch: z.string().optional(),
      branches: z.array(z.string()).default([]),
      worktrees: z.array(Worktree).default([]),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  interface State {
    current: string | undefined
    root: Git.Base | undefined
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly defaultBranch: () => Effect.Effect<string | undefined>
    readonly info: () => Effect.Effect<Info>
    readonly diff: (mode: Mode) => Effect.Effect<Snapshot.FileDiff[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Git.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const git = yield* Git.Service
      const scope = yield* Scope.Scope
      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")((ctx) =>
          Effect.gen(function* () {
            if (ctx.project.vcs !== "git") {
              return { current: undefined, root: undefined }
            }

            const get = () => Effect.runPromise(git.branch(ctx.directory))
            const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
              concurrency: 2,
            })
            const value = { current, root }
            log.info("initialized", { branch: value.current, default_branch: value.root?.name })

            yield* Effect.acquireRelease(
              Effect.sync(() =>
                Bus.subscribe(
                  FileWatcher.Event.Updated,
                  Instance.bind(async (evt) => {
                    if (!evt.properties.file.endsWith("HEAD")) return
                    const next = await get()
                    if (next === value.current) return
                    log.info("branch changed", { from: value.current, to: next })
                    value.current = next
                    Bus.publish(Event.BranchUpdated, { branch: next })
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
          yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
        }),
        branch: Effect.fn("Vcs.branch")(function* () {
          return yield* InstanceState.use(state, (x) => x.current)
        }),
        defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
          return yield* InstanceState.use(state, (x) => x.root?.name)
        }),
        info: Effect.fn("Vcs.info")(function* () {
          const value = yield* InstanceState.get(state)
          if (Instance.project.vcs !== "git") {
            return {
              branch: undefined,
              default_branch: undefined,
              branches: [],
              worktrees: [],
            }
          }

          const [branches, worktrees] = yield* Effect.all(
            [branchList(git, Instance.worktree), worktreeList(git, Instance.worktree)],
            { concurrency: 2 },
          )

          return {
            branch: value.current,
            default_branch: value.root?.name,
            branches,
            worktrees,
          }
        }),
        diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
          const value = yield* InstanceState.get(state)
          if (Instance.project.vcs !== "git") return []
          if (mode === "git") {
            return yield* track(
              fs,
              git,
              Instance.directory,
              (yield* git.hasHead(Instance.directory)) ? "HEAD" : undefined,
            )
          }

          if (!value.root) return []
          if (value.current && value.current === value.root.name) return []
          const ref = yield* git.mergeBase(Instance.directory, value.root.ref)
          if (!ref) return []
          return yield* compare(fs, git, Instance.directory, ref)
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Git.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

  const runPromise = makeRunPromise(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export function branch() {
    return runPromise((svc) => svc.branch())
  }

  export function defaultBranch() {
    return runPromise((svc) => svc.defaultBranch())
  }

  export function info() {
    return runPromise((svc) => svc.info())
  }

  export function diff(mode: Mode) {
    return runPromise((svc) => svc.diff(mode))
  }
}
