export * as Vcs from "./vcs"

import path from "path"
import { Context, Effect, Layer, Stream } from "effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "./bus"
import { Git } from "./git"
import { Watcher } from "./filesystem/watcher"
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
    const git = yield* Git.Service
    const watcher = yield* Watcher.Service
    const impl = adapter(proc, fs, location)
    const vcs = location.vcs
    const state = { info: impl ? yield* impl.info() : ({ branch: {} } satisfies Info) }

    if (vcs && impl) {
      yield* Effect.gen(function* () {
        const discovered = vcs.type === "git" ? (yield* git.repo.discover(location.directory))?.gitDirectory : undefined
        const target = discovered ?? vcs.store
        const dir = yield* fs.realPath(target).pipe(Effect.catch(() => Effect.succeed(target)))
        const keep = vcs.type === "git" ? ["HEAD", "HEAD.lock"] : ["branch"]
        const ignore = (yield* fs.readDirectoryEntries(dir).pipe(Effect.catch(() => Effect.succeed([])))).flatMap(
          (entry) => (keep.includes(entry.name) ? [] : [entry.name]),
        )
        const updates = yield* watcher.subscribe({ path: dir, type: "directory", ignore })
        yield* updates.pipe(
          Stream.filter((update) => keep.includes(path.basename(update.path))),
          Stream.runForEach((update) =>
            Effect.gen(function* () {
              const next = yield* impl.info()
              const changed = state.info.branch.current !== next.branch.current
              state.info = next
              if (!changed) return
              yield* bus.publish(VcsEvent.BranchUpdated, { branch: next.branch.current })
            }).pipe(Effect.withSpan("Vcs.refreshBranch", { attributes: { file: update.path } })),
          ),
          Effect.forkScoped({ startImmediately: true }),
        )
      }).pipe(Effect.catchCause((cause) => Effect.logError("failed to watch vcs metadata", { cause })))
    }

    return Service.of({
      info: Effect.fn("Vcs.info")(function* () {
        return state.info
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
  deps: [AppProcess.node, FSUtil.node, Location.node, Bus.node, Git.node, Watcher.node],
})
