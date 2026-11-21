import { withEnsureTiming } from "../../src/service-timing"

const timing = {
  pollInterval: 20,
  requestTimeout: 100,
  unresponsiveAfter: 2_000,
  spawnDelay: 200,
  maxSpawnDelay: 1_200,
  promiseTimeout: 3_000,
  stopPollInterval: 5,
}

export function accelerate<A extends object, B>(ensure: (options?: A) => B, overrides: Partial<typeof timing> = {}) {
  return (options: A) => ensure(withEnsureTiming(options, { ...timing, ...overrides }))
}

export async function waitForExit(pid: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for process ${pid}`)
}
