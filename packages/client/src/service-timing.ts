export type EnsureTiming = {
  readonly pollInterval: number
  readonly attempts: number
  readonly requestTimeout: number
  readonly spawnDelay: number
  readonly maxSpawnDelay: number
  readonly promiseTimeout: number
  readonly stopPollInterval: number
  readonly stopPollAttempts: number
}

const timings = new WeakMap<object, EnsureTiming>()

export const defaultEnsureTiming: EnsureTiming = {
  pollInterval: 1_000,
  attempts: 120,
  requestTimeout: 2_000,
  spawnDelay: 5_000,
  maxSpawnDelay: 30_000,
  promiseTimeout: 120_000,
  stopPollInterval: 50,
  stopPollAttempts: 100,
}

export function ensureTiming(options: object) {
  return timings.get(options) ?? defaultEnsureTiming
}

// Keep test timing out of the public lifecycle option types.
export function withEnsureTiming<A extends object>(options: A, overrides: Partial<EnsureTiming>): A {
  timings.set(options, { ...defaultEnsureTiming, ...overrides })
  return options
}
