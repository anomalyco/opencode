export * as TuiPackages from "./tui-packages"

import { randomUUID } from "node:crypto"
import path from "node:path"
import { Effect, FileSystem, Schema } from "effect"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"

const Current = Schema.fromJsonString(
  Schema.Struct({
    entrypoint: Schema.String,
    revision: Schema.optional(Schema.String),
  }),
)

export const make = Effect.gen(function* () {
  const npm = yield* Npm.Service
  const global = yield* Global.Service
  const fs = yield* FileSystem.FileSystem
  const directory = (spec: string) =>
    Effect.map(
      Effect.promise(() => Npm.cacheKey(spec)),
      (key) => path.join(global.cache, "tui-packages", key),
    )
  const current = Effect.fnUntraced(function* (spec: string) {
    const file = path.join(yield* directory(spec), "current.json")
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Current)),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
    )
  })
  const resolve = Effect.fn("TuiPackages.resolve")(function* (spec: string, install = true) {
    if (!install) return yield* npm.resolve(spec, { subpaths: ["tui"] })
    return (yield* current(spec)) ?? (yield* npm.add(spec, { subpaths: ["tui"] }))
  })
  const check = Effect.fn("TuiPackages.check")(function* (spec: string) {
    const status = yield* npm.check(spec)
    const selected = yield* current(spec)
    return selected ? { ...status, installed: selected.revision } : status
  })
  const update = Effect.fn("TuiPackages.update")(function* (spec: string) {
    const status = yield* npm.check(spec)
    if (!status.mutable) return yield* Effect.fail(new Error("Pinned packages cannot be updated"))
    const dir = yield* directory(spec)
    yield* fs.makeDirectory(dir, { recursive: true })
    // Arborist root links do not expose the installed package edges.
    const root = path.join(yield* fs.realPath(dir), randomUUID())
    // Finish non-abortable installation before removing a failed tree. Imported trees stay immutable until GC.
    return yield* npm.add(spec, { root, subpaths: ["tui"] }).pipe(
      Effect.onError(() => fs.remove(root, { recursive: true, force: true }).pipe(Effect.ignore)),
      Effect.uninterruptible,
    )
  })
  const commit = Effect.fn("TuiPackages.commit")(function* (
    spec: string,
    entry: { readonly entrypoint?: string; readonly revision?: string },
  ) {
    if (!entry.entrypoint) return yield* Effect.fail(new Error("Package has no TUI entrypoint"))
    const dir = yield* directory(spec)
    const temp = path.join(dir, `${randomUUID()}.tmp`)
    yield* fs.makeDirectory(dir, { recursive: true })
    return yield* fs
      .writeFileString(temp, JSON.stringify({ entrypoint: entry.entrypoint, revision: entry.revision }))
      .pipe(
        Effect.andThen(fs.rename(temp, path.join(dir, "current.json"))),
        Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.ignore)),
        Effect.uninterruptible,
      )
  })
  return {
    resolve: (spec: string, install = true): Promise<{ entrypoint?: string; revision?: string }> =>
      runPromise(resolve(spec, install)),
    check: (spec: string) => runPromise(check(spec)),
    update: (spec: string) => runPromise(update(spec)),
    commit: (spec: string, entry: { readonly entrypoint?: string; readonly revision?: string }) =>
      runPromise(commit(spec, entry)),
  }
})

function runPromise<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.mapError((error) => (error instanceof Error && error.cause instanceof Error ? error.cause : error)),
    ),
  )
}
