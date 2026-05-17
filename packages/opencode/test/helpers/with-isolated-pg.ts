import { Database } from "../../src/storage/db.pg"
import { startPgTestContainer } from "./pg-testcontainer"

/** Serialize: global `Database` pool + `DATABASE_URL` must not overlap across files if Bun runs tests in parallel. */
let gate = Promise.resolve()

/**
 * Moves `DATABASE_URL` to a new disposable Postgres, runs `fn`, then restores preload URL and reconnects.
 * Requires `installTestEnv()` to have set `DATABASE_URL` first.
 */
export async function withIsolatedPg<T>(fn: () => Promise<T>): Promise<T> {
  const prev = gate
  let done!: () => void
  gate = new Promise<void>((resolve) => {
    done = resolve
  })
  await prev

  const shared = process.env.DATABASE_URL?.trim()
  if (!shared) throw new Error("DATABASE_URL missing (preload should set it)")

  let c: Awaited<ReturnType<typeof startPgTestContainer>> | undefined
  try {
    await Database.close()
    c = await startPgTestContainer()
    process.env.DATABASE_URL = c.url
    return await fn()
  } finally {
    if (c) {
      await Database.close()
      await c.stop()
    }
    process.env.DATABASE_URL = shared
    await Database.initialize()
    done()
  }
}
