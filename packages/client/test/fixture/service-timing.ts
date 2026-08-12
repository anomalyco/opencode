import { withEnsureTiming } from "../../src/service-timing"

const timing = {
  pollInterval: 20,
  attempts: 120,
  probeTimeout: 100,
  spawnDelay: 200,
  maxSpawnDelay: 1_200,
  promiseTimeout: 3_000,
  stopPollInterval: 5,
  stopPollAttempts: 100,
}

export function accelerate<A extends object>(options: A): A {
  return withEnsureTiming(options, timing)
}
