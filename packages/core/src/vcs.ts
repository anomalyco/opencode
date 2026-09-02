export * as Vcs from "./vcs.js"

import path from "path"
import { Cause, Context, Effect, FiberSet, Layer, Schema, Semaphore, Stream } from "effect"
import type { VcsDefinition, VcsDraft } from "@opencode-ai/plugin/effect/vcs"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Base, BranchList, FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location.js"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { emptyPatch, MAX_TOTAL_PATCH_BYTES, PATCH_CONTEXT_LINES } from "./vcs/patch.js"

export { Base, BranchList, FileStatus, Info, Mode }

export class DiffError extends Schema.TaggedError<DiffError>()("Vcs.DiffError", {
  message: Schema.String,
}) {}

export interface DiffOptions {
  readonly context?: number
  readonly base?: string
}

export interface BranchOptions {
  readonly search?: string
  readonly limit?: number
}

export interface Adapter {
  readonly info: () => Effect.Effect<Info>
  readonly base?: () => Effect.Effect<Base | null, DiffError>
  readonly branches: (options?: BranchOptions) => Effect.Effect<BranchList>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff.Info[], DiffError>
}

export interface Interface extends Adapter, State.Transformable<VcsDraft> {
  readonly base: () => Effect.Effect<Base | null, DiffError>
}

interface Data {
  readonly providers: Map<string, VcsDefinition>
  selection?: string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const bus = yield* Bus.Service
    const root = yield* Effect.scope
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const vcs = location.vcs
    const current: { info: Info } = { info: { branch: {} } }
    const refreshLock = Semaphore.makeUnsafe(1)
    const scope = {
      directory: location.directory,
      worktree: location.project.directory,
      canonical: location.project.canonical,
      ...(vcs ? { store: vcs.store } : {}),
    }
    const decodeInfo = Schema.decodeUnknownEffect(Schema.toType(Info))
    const decodeBase = Schema.decodeUnknownEffect(Schema.NullOr(Base))
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
      notify: () => State.reconcile(root, fork, () => refresh()),
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
    const review = <A>(provider: VcsDefinition, operation: "base" | "diff", effect: Effect.Effect<A, unknown>) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) return Effect.failCause(cause).pipe(Effect.orDie)
          const error = Cause.squash(cause)
          return Effect.logWarning("vcs provider failed", { provider: provider.id, operation, cause }).pipe(
            Effect.andThen(
              Effect.fail(
                error instanceof DiffError
                  ? error
                  : new DiffError({
                      message:
                        operation === "base"
                          ? "VCS provider could not resolve a review base"
                          : "VCS provider could not produce a diff",
                    }),
              ),
            ),
          )
        }),
      )
    const refresh = Effect.fn("Vcs.refresh")(function* () {
      const changed = yield* Effect.gen(function* () {
        const provider = selected()
        const next: Info = provider
          ? yield* protect(provider, "info", provider.info(scope).pipe(Effect.flatMap(decodeInfo)), { branch: {} })
          : { branch: {} }
        const changed = current.info.branch.current !== next.branch.current
        current.info = next
        return changed
      }).pipe(Semaphore.withPermit(refreshLock))
      if (!changed) return
      // Legacy listeners can publish nested updates before streams and SSE receive
      // this event. Re-announce the latest branch if publication was overtaken.
      while (true) {
        const branch = current.info.branch.current
        yield* bus.publish(VcsEvent.BranchUpdated, { branch })
        if (branch === current.info.branch.current) return
      }
    })

    if (vcs) {
      const store = yield* fs.realPath(vcs.store).pipe(Effect.orElseSucceed(() => vcs.store))
      const isBranchMetadata =
        vcs.type === "git"
          ? (file: string) => path.basename(file) === "HEAD" && FSUtil.contains(store, file)
          : (file: string) => path.resolve(file) === path.join(store, "branch")
      yield* bus.subscribe(FileSystem.Event.Changed).pipe(
        Stream.filter((event) => isBranchMetadata(event.data.file)),
        Stream.runForEach((event) =>
          refresh().pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) => Effect.logWarning("vcs refresh failed", { file: event.data.file, cause }),
            ),
            Effect.withSpan("Vcs.refreshBranch", { attributes: { file: event.data.file } }),
          ),
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
      base: Effect.fn("Vcs.base")(function* () {
        const provider = selected()
        if (!provider?.base) return null
        return yield* review(provider, "base", provider.base(scope).pipe(Effect.flatMap(decodeBase)))
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
        return []
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
        return []
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const provider = selected()
        if (!provider) return []
        const rows = yield* review(
          provider,
          "diff",
          provider
            .diff({
              ...scope,
              mode,
              ...(options?.base !== undefined ? { base: options.base } : {}),
              context: options?.context ?? PATCH_CONTEXT_LINES,
              maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
            })
            .pipe(Effect.flatMap(decodeDiff)),
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
  deps: [FSUtil.node, Location.node, Bus.node],
})
