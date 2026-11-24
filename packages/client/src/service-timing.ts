export type EnsureTiming = {
  readonly pollInterval: number
  readonly requestTimeout: number
  readonly spawnDelay: number
  readonly maxSpawnDelay: number
  readonly promiseTimeout: number
  readonly stopPollInterval: number
  readonly stopPollAttempts: number
  readonly unresponsiveWindow: number
  readonly unresponsiveFailures: number
  readonly restartCooldown: number
  readonly restartLockStale: number
  readonly signal?: (pid: number, name: NodeJS.Signals) => void
}

const timings = new WeakMap<object, EnsureTiming>()

// A freshly spawned service registers in ~250 ms, so the poll cadence is a large share of the
// time a client waits for it. Probes are sequential, so the wait between them only matters while
// the connection is refused; both variants give up after promiseTimeout of wall-clock time.
// promiseTimeout must stay longer than unresponsiveWindow: the loop stops at this deadline, so a
// window that reaches or exceeds it could never elapse and escalation would be unreachable.
export const defaultEnsureTiming: EnsureTiming = {
  pollInterval: 25,
  requestTimeout: 2_000,
  spawnDelay: 5_000,
  maxSpawnDelay: 30_000,
  promiseTimeout: 300_000,
  stopPollInterval: 50,
  stopPollAttempts: 100,
  // A starting service can stall the event loop for a long time while loading plugins. Only treat a
  // sustained streak of failed probes as unresponsive, so a slow boot is not mistaken for a dead server.
  unresponsiveWindow: 120_000,
  unresponsiveFailures: 12,
  // Shared across processes through the restart lock file: clients that see a completed reboot wait
  // out this cooldown before starting their own, and abandon a lock whose owner died or stalled.
  restartCooldown: 30_000,
  restartLockStale: 600_000,
}

export function ensureTiming(options: object) {
  return timings.get(options) ?? defaultEnsureTiming
}

// Keep test timing out of the public lifecycle option types.
export function withEnsureTiming<A extends object>(options: A, overrides: Partial<EnsureTiming>): A {
  timings.set(options, { ...defaultEnsureTiming, ...overrides })
  return options
}
