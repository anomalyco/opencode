import { Effect, Layer, Context, Schema, Stream, Scope } from "effect"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import * as Log from "@opencode-ai/core/util/log"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

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
  const patch = (file: string, before: string, after: string) =>
    formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
  const next = yield* Effect.forEach(
    list,
    (item) =>
      Effect.gen(function* () {
        const before = item.status === "added" || !ref ? "" : yield* git.show(cwd, ref, item.file, base)
        const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
        const stat = map.get(item.file)
        return {
          file: item.file,
          patch: patch(item.file, before, after),
          additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
          deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
          status: item.status,
        } satisfies FileDiff
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

export const Mode = Schema.Literals(["git", "branch"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = {
  BranchUpdated: BusEvent.define(
    "vcs.branch.updated",
    Schema.Struct({
      branch: Schema.optional(Schema.String),
    }),
  ),
}

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
})
  .annotate({ identifier: "VcsInfo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
  .annotate({ identifier: "VcsFileDiff" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly diff: (mode: Mode) => Effect.Effect<FileDiff[]>
}

interface State {
  current: string | undefined
  root: Git.Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Git.Service | Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const get = Effect.fnUntraced(function* () {
          return yield* git.branch(ctx.directory)
        })
        const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }
        log.info("initialized", { branch: value.current, default_branch: value.root?.name })

        yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
          Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
          Stream.runForEach((_evt) =>
            Effect.gen(function* () {
              const next = yield* get()
              if (next !== value.current) {
                log.info("branch changed", { from: value.current, to: next })
                value.current = next
                yield* bus.publish(Event.BranchUpdated, { branch: next })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return value
      }),
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
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(fs, git, ctx.directory, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* compare(fs, git, ctx.directory, ref)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Bus.layer),
)

export * as Vcs from "./vcs"
