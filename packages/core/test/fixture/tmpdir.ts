import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, PlatformError } from "effect"

type TempDir = { readonly path: string }

export const tmpdir = async (prefix = "opencode-core-test-") => {
  const dir = await make(prefix).pipe(Effect.provide(NodeFileSystem.layer), Effect.runPromise)
  return {
    path: dir,
    [Symbol.asyncDispose]() {
      return remove(dir).pipe(Effect.provide(NodeFileSystem.layer), Effect.runPromise)
    },
  }
}

export const tmpdirScoped = (prefix = "opencode-core-test-") =>
  Effect.acquireRelease(make(prefix), (dir) => remove(dir).pipe(Effect.orDie)).pipe(
    Effect.map((path) => ({ path })),
    Effect.provide(NodeFileSystem.layer),
  )

export const withTempDir = <A, E, R>(body: (tmp: TempDir) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    make("opencode-core-test-"),
    (path) => body({ path }),
    (dir) => remove(dir).pipe(Effect.orDie),
  ).pipe(Effect.provide(NodeFileSystem.layer))

const make = (prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectory({ prefix }).pipe(Effect.flatMap(fs.realPath))
  })

function remove(dir: string, retries = 30): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.remove(dir, { recursive: true, force: true }).pipe(
      Effect.catchReason("PlatformError", "Busy", (_, error) => {
        if (retries === 0) return Effect.fail(error)
        return Effect.sync(() => Bun.gc(true)).pipe(
          Effect.andThen(Effect.sleep(100)),
          Effect.andThen(remove(dir, retries - 1)),
        )
      }),
    )
  })
}
