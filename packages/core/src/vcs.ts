export * as Vcs from "./vcs"

import { Context, Effect, Layer } from "effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Mode } from "@opencode-ai/schema/vcs"
import { makeLocationNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { AppProcess } from "./process"
import { VcsGit } from "./vcs/git"
import { VcsHg } from "./vcs/hg"

export { FileStatus, Mode }

export interface DiffOptions {
  readonly context?: number
}

export interface Interface {
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff.Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Vcs") {}

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
    const impl = adapter(proc, fs, location)
    return Service.of({
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
  deps: [AppProcess.node, FSUtil.node, Location.node],
})
