import { AppFileSystem } from "@/filesystem"
import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { GitEffect } from "@/git/effect"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import path from "path"
import { Instance } from "./instance"
import z from "zod"

function count(text: string) {
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

function stats(list: GitEffect.Stat[]) {
  const out = new Map<string, { additions: number; deletions: number }>()
  for (const item of list) {
    out.set(item.file, {
      additions: item.additions,
      deletions: item.deletions,
    })
  }
  return out
}

function merge(...lists: GitEffect.Item[][]) {
  const out = new Map<string, GitEffect.Item>()
  for (const list of lists) {
    for (const item of list) {
      if (!out.has(item.file)) out.set(item.file, item)
    }
  }
  return [...out.values()]
}

const files = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: GitEffect.Interface,
  cwd: string,
  ref: string | undefined,
  list: GitEffect.Item[],
  nums: Map<string, { additions: number; deletions: number }>,
) {
  const base = ref ? yield* git.prefix(cwd) : ""
  const next = yield* Effect.forEach(
    list,
    (item) =>
      Effect.gen(function* () {
        const before = item.status === "added" || !ref ? "" : yield* git.show(cwd, ref, item.file, base)
        const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
        const stat = nums.get(item.file)
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
  git: GitEffect.Interface,
  cwd: string,
  ref: string | undefined,
) {
  if (!ref) {
    return yield* files(fs, git, cwd, ref, yield* git.status(cwd), new Map())
  }
  const [list, nums] = yield* Effect.all([git.status(cwd), git.stats(cwd, ref)], { concurrency: 2 })
  return yield* files(fs, git, cwd, ref, list, stats(nums))
})

const compare = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: GitEffect.Interface,
  cwd: string,
  ref: string,
) {
  const [list, nums, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
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
    stats(nums),
  )
})

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

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

  export const Info = z
    .object({
      branch: z.string().optional(),
      default_branch: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly branch: () => Effect.Effect<string | undefined>
    readonly defaultBranch: () => Effect.Effect<string | undefined>
    readonly diff: (mode: Mode) => Effect.Effect<Snapshot.FileDiff[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      const fs = yield* AppFileSystem.Service
      const git = yield* GitEffect.Service
      let current: string | undefined
      let root: GitEffect.Base | undefined

      if (instance.project.vcs === "git") {
        const get = () => Effect.runPromise(git.branch(instance.directory))

        ;[current, root] = yield* Effect.all([git.branch(instance.directory), git.defaultBranch(instance.directory)], {
          concurrency: 2,
        })
        log.info("initialized", { branch: current, default_branch: root?.name })

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bus.subscribe(
              FileWatcher.Event.Updated,
              Instance.bind(async (evt) => {
                if (!evt.properties.file.endsWith("HEAD")) return
                const next = await get()
                if (next === current) return
                log.info("branch changed", { from: current, to: next })
                current = next
                Bus.publish(Event.BranchUpdated, { branch: next })
              }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        )
      }

      return Service.of({
        branch: Effect.fn("Vcs.branch")(function* () {
          return current
        }),
        defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
          return root?.name
        }),
        diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
          if (instance.project.vcs !== "git") return []
          if (mode === "git") {
            const ok = yield* git.hasHead(instance.directory)
            return yield* track(fs, git, instance.directory, ok ? "HEAD" : undefined)
          }

          if (!root) return []
          if (current && current === root.name) return []
          const ref = yield* git.mergeBase(instance.directory, root.ref)
          if (!ref) return []
          return yield* compare(fs, git, instance.directory, ref)
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(GitEffect.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
}
