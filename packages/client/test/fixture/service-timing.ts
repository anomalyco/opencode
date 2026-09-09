import { withEnsureTiming } from "../../src/service-timing"

const timing = {
  pollInterval: 20,
  attempts: 120,
  requestTimeout: 100,
  spawnDelay: 200,
  maxSpawnDelay: 1_200,
  promiseTimeout: 3_000,
  stopPollInterval: 5,
}

export function accelerate<A extends object, B>(ensure: (options?: A) => B) {
  return (options: A) => ensure(withEnsureTiming(options, timing))
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
