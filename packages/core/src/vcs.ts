export * as Vcs from "./vcs.js"

import path from "path"
import { Cause, Context, Effect, Layer, Schema, Stream } from "effect"
import type { VcsDefinition, VcsDraft } from "@opencode-ai/plugin/effect/vcs"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { BranchList, FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location.js"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { VcsGit } from "./vcs/git.js"
import { VcsHg } from "./vcs/hg.js"
import { emptyPatch, MAX_TOTAL_PATCH_BYTES, PATCH_CONTEXT_LINES } from "./vcs/patch.js"

export { BranchList, FileStatus, Info, Mode }

export interface DiffOptions {
  readonly context?: number
}

export interface BranchOptions {
  readonly search?: string
  readonly limit?: number
}

export interface Adapter {
  readonly info: () => Effect.Effect<Info>
  readonly branches: (options?: BranchOptions) => Effect.Effect<BranchList>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff.Info[]>
}

export interface Interface extends Adapter, State.Transformable<VcsDraft> {}

interface Data {
  readonly providers: Map<string, VcsDefinition>
  selection?: string
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
    const native = adapter(proc, fs, location)
    const vcs = location.vcs
    const current = { info: native ? yield* native.info() : ({ branch: {} } satisfies Info) }
    const scope = {
      directory: location.directory,
      worktree: location.project.directory,
      canonical: location.project.canonical,
      ...(vcs ? { store: vcs.store } : {}),
    }
    const decodeInfo = Schema.decodeUnknownEffect(Info)
    const decodeBranches = Schema.decodeUnknownEffect(BranchList)
    const decodeStatus = Schema.decodeUnknownEffect(Schema.Array(FileStatus))
    const decodeDiff = Schema.decodeUnknownEffect(Schema.Array(FileDiff.Info))
    const state: State.Interface<Data, VcsDraft> = State.create<Data, VcsDraft>({
      name: "vcs",
      initial: () => ({ providers: new Map() }),
      draft: (draft) => ({
        add: (provider) => draft.providers.set(provider.id, provider),
        default: {
          get: () => draft.selection,
          set: (selection) => (draft.selection = selection),
        },
      }),
      finalize: () => refresh(),
    })
    const selected = () => {
      const value = state.get()
      const id = value.selection ?? vcs?.type
      return id ? value.providers.get(id) : undefined
    }
    const protect = <A>(provider: VcsDefinition, operation: string, effect: Effect.Effect<A, unknown>, fallback: A) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.failCause(cause).pipe(Effect.orDie)
            : Effect.logWarning("vcs provider failed", { provider: provider.id, operation, cause }).pipe(
                Effect.as(fallback),
              ),
        ),
      )
    const refresh = Effect.fn("Vcs.refresh")(function* () {
      const provider = selected()
      const next: Info = provider
        ? yield* protect(provider, "info", provider.info(scope).pipe(Effect.flatMap(decodeInfo)), { branch: {} })
        : native
          ? yield* native.info()
          : { branch: {} }
      const changed = current.info.branch.current !== next.branch.current
      current.info = next
      if (changed) yield* bus.publish(VcsEvent.BranchUpdated, { branch: next.branch.current })
    })

    if (vcs && native) {
      const store = yield* fs.realPath(vcs.store).pipe(Effect.orElseSucceed(() => vcs.store))
      const isBranchMetadata =
        vcs.type === "git"
          ? (file: string) => path.basename(file) === "HEAD" && FSUtil.contains(store, file)
          : (file: string) => path.resolve(file) === path.join(store, "branch")
      yield* bus.subscribe(FileSystem.Event.Changed).pipe(
        Stream.filter((event) => isBranchMetadata(event.data.file)),
        Stream.runForEach((event) =>
          refresh().pipe(Effect.withSpan("Vcs.refreshBranch", { attributes: { file: event.data.file } })),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    }

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      info: Effect.fn("Vcs.info")(function* () {
        return current.info
      }),
      branches: Effect.fn("Vcs.branches")(function* (options?: BranchOptions) {
        const provider = selected()
        if (provider)
          return yield* protect(
            provider,
            "branches",
            provider.branches({ ...scope, ...options }).pipe(Effect.flatMap(decodeBranches)),
            [],
          )
        if (!native) return []
        return yield* native.branches(options)
      }),
      status: Effect.fn("Vcs.status")(function* () {
        const provider = selected()
        if (provider)
          return yield* protect(
            provider,
            "status",
            provider.status(scope).pipe(
              Effect.flatMap(decodeStatus),
              Effect.map((rows) => Array.from(rows)),
            ),
            [],
          )
        if (!native) return []
        return yield* native.status()
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const provider = selected()
        if (!provider) return native ? yield* native.diff(mode, options) : []
        const rows = yield* protect(
          provider,
          "diff",
          provider
            .diff({
              ...scope,
              mode,
              context: options?.context ?? PATCH_CONTEXT_LINES,
              maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
            })
            .pipe(Effect.flatMap(decodeDiff)),
          [],
        )
        let total = 0
        return rows.map((row) => {
          const bytes = Buffer.byteLength(row.patch)
          if (total + bytes > MAX_TOTAL_PATCH_BYTES) return { ...row, patch: emptyPatch(row.file) }
          total += bytes
          return row
        })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer,
  deps: [AppProcess.node, FSUtil.node, Location.node, Bus.node],
})
