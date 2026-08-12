export type EnsureTiming = {
  readonly pollInterval: number
  readonly probeTimeout: number
  readonly spawnDelay: number
  readonly maxSpawnDelay: number
  readonly promiseTimeout: number
  readonly stopPollInterval: number
  readonly stopPollAttempts: number
}

const timings = new WeakMap<object, EnsureTiming>()

const defaults: EnsureTiming = {
  pollInterval: 1_000,
  probeTimeout: 2_000,
  spawnDelay: 5_000,
  maxSpawnDelay: 30_000,
  promiseTimeout: 120_000,
  stopPollInterval: 50,
  stopPollAttempts: 100,
}

export function ensureTiming(options: object) {
  return timings.get(options) ?? defaults
}

// Keep test timing out of the public lifecycle option types.
export function withEnsureTiming<A extends object>(options: A, value: EnsureTiming): A {
  timings.set(options, value)
  return options
}
