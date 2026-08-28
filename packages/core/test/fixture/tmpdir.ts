import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"

type TempDir = { readonly path: string }

export const tmpdir = async (prefix = "opencode-core-test-") => {
  const dir = await make(prefix)
  return {
    path: dir,
    [Symbol.asyncDispose]() {
      return remove(dir)
    },
  }
}

export const tmpdirScoped = (prefix = "opencode-core-test-") =>
  Effect.acquireRelease(
    Effect.tryPromise(() => make(prefix)),
    (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie),
  ).pipe(Effect.map((path) => ({ path })))

export const withTempDir = <A, E, R>(body: (tmp: TempDir) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => make("opencode-core-test-")),
    (path) => body({ path }),
    (dir) => Effect.tryPromise(() => remove(dir)).pipe(Effect.orDie),
  )

const make = async (prefix: string) => fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))

// Bun's callback APIs expose short paths and can hang during recursive removal on Windows.
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
