import { NodeFileSystem } from "@effect/platform-node"
import fs from "fs/promises"
import { Effect, FileSystem } from "effect"

type TempDir = { readonly path: string }

export const tmpdir = async (prefix = "opencode-core-test-") => {
  const dir = await make(prefix).pipe(Effect.provide(NodeFileSystem.layer), Effect.runPromise)
  return {
    path: dir,
    [Symbol.asyncDispose]() {
      return remove(dir)
    },
  }
}

export const tmpdirScoped = (prefix = "opencode-core-test-") =>
  Effect.acquireRelease(make(prefix), (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie)).pipe(
    Effect.map((path) => ({ path })),
    Effect.provide(NodeFileSystem.layer),
  )

export const withTempDir = <A, E, R>(body: (tmp: TempDir) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    make("opencode-core-test-"),
    (path) => body({ path }),
    (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie),
  ).pipe(Effect.provide(NodeFileSystem.layer))

const make = (prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectory({ prefix }).pipe(Effect.flatMap(fs.realPath))
  })

// Bun's callback-based recursive removal can hang on Windows, so keep the proven promise API at this boundary.
async function remove(dir: string, retries = 30): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    if (retries === 0 || !error || typeof error !== "object" || !("code" in error) || error.code !== "EBUSY")
      throw error
    Bun.gc(true)
    await Bun.sleep(100)
    return remove(dir, retries - 1)
  }
}
