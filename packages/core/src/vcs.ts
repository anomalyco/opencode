export * as Vcs from "./vcs"

import { Context, Effect, Layer, Ref, Stream } from "effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { FileStatus, Mode } from "@opencode-ai/schema/vcs"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location"
import { AppProcess } from "@opencode-ai/util/process"
import { VcsGit } from "./vcs/git"
import { VcsHg } from "./vcs/hg"
import { Bus } from "./bus"

export { FileStatus, Mode }

export interface DiffOptions {
  readonly context?: number
}

export interface Interface {
  readonly branch: () => Effect.Effect<string | undefined>
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
    const branch = yield* Ref.make(impl ? yield* impl.branch() : undefined)
    if (impl && location.vcs?.type === "git") {
      yield* bus.subscribe(FileSystem.Event.Changed).pipe(
        Stream.filter((event) => event.data.file.endsWith("HEAD")),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const next = yield* impl.branch()
            if (next === (yield* Ref.get(branch))) return
            yield* Ref.set(branch, next)
            yield* bus.publish(VcsEvent.BranchUpdated, { branch: next }, {
              location: { directory: location.directory, workspaceID: location.workspaceID },
            })
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    }
    return Service.of({
      branch: Effect.fn("Vcs.branch")(function* () {
        if (!impl) return
        return yield* impl.branch()
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
