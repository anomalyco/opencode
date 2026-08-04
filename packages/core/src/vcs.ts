export * as Vcs from "./vcs"

import path from "path"
import { Context, Effect, Layer, Ref, Stream } from "effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "./bus"
import { VcsGit } from "./vcs/git"
import { VcsHg } from "./vcs/hg"

export { FileStatus, Info, Mode }

export interface DiffOptions {
  readonly context?: number
}

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff.Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

// Adapter seam: one working-copy implementation per VCS type, selected by the
// resolved location. Locations without a supported VCS degrade to empty
// results so callers never need to special-case.
const adapter = (proc: AppProcess.Interface, fs: FSUtil.Interface, location: Location.Interface) => {
  const scope = { directory: location.directory, worktree: location.project.directory }
  if (location.vcs?.type === "git") return VcsGit.make(proc, scope)
  if (location.vcs?.type === "hg") return VcsHg.make(proc, fs, scope)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const bus = yield* Bus.Service
    const impl = adapter(proc, fs, location)
    const vcs = location.vcs
    const cache = vcs && impl ? yield* Ref.make(yield* impl.info()) : undefined

    if (cache && vcs && impl) {
      const store = yield* fs.realPath(vcs.store).pipe(Effect.catch(() => Effect.succeed(vcs.store)))
      yield* bus.subscribe(FileSystem.Event.Changed).pipe(
        Stream.filter(
          (event) =>
            vcs.type === "git"
              ? path.basename(event.data.file) === "HEAD" && FSUtil.contains(store, event.data.file)
              : path.resolve(event.data.file) === path.join(store, "branch"),
        ),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const previous = yield* Ref.get(cache)
            const next = yield* impl.info()
            yield* Ref.set(cache, next)
            if (previous.branch.current === next.branch.current) return
            yield* bus.publish(VcsEvent.BranchUpdated, { branch: next.branch.current })
          }).pipe(Effect.withSpan("Vcs.refreshBranch", { attributes: { file: event.data.file } })),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    }

    const info = Effect.fnUntraced(function* () {
      if (!impl) return { branch: {} }
      if (!cache) return yield* impl.info()
      const current = yield* Ref.get(cache)
      if (current.branch.current !== undefined && current.branch.default !== undefined) return current
      // An unborn repository can gain its first branch without changing existing metadata.
      const next = yield* impl.info()
      yield* Ref.set(cache, next)
      return next
    })

    return Service.of({
      info: Effect.fn("Vcs.info")(function* () {
        return yield* info()
      }),
      status: Effect.fn("Vcs.status")(function* () {
        if (!impl) return []
        return yield* impl.status()
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        if (!impl) return []
        return yield* impl.diff(mode, options)
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer,
  deps: [AppProcess.node, FSUtil.node, Location.node, Bus.node],
})
