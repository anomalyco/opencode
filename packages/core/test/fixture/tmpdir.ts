import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"

export const tmpdir = async (prefix = "opencode-core-test-") => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await remove(dir)
    },
  }
}

export const withTempDir = <A, E, R>(body: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    body,
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

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
