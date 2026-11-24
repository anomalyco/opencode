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
  readonly startingWindow: number
  readonly startingFailures: number
  readonly restartCooldown: number
  readonly restartLockStale: number
  /** Test hook for deterministic cross-process restart timing. */
  readonly now?: () => number
  readonly signal?: (pid: number, name: NodeJS.Signals) => void
}

const timings = new WeakMap<object, EnsureTiming>()

// A freshly spawned service registers in ~250 ms, so the poll cadence is a large share of the
// time a client waits for it. Probes are sequential, so the wait between them only matters while
// the connection is refused; both variants give up after promiseTimeout of wall-clock time.
// promiseTimeout must stay longer than startingWindow: the loop stops at this deadline, so a
// window that reaches or exceeds it could never elapse and escalation would be unreachable.
export const defaultEnsureTiming: EnsureTiming = {
  pollInterval: 25,
  requestTimeout: 2_000,
  spawnDelay: 5_000,
  maxSpawnDelay: 30_000,
  promiseTimeout: 300_000,
  stopPollInterval: 50,
  stopPollAttempts: 100,
  // A service that was ready and stops answering is hung: three two-second probes replace it in
  // roughly six seconds, as before the slow-boot tolerance was added.
  unresponsiveWindow: 0,
  unresponsiveFailures: 3,
  // A service still reporting `starting` may hold its event loop for minutes while loading. Only
  // escalate after this much longer streak, and let promiseTimeout bound the overall wait.
  startingWindow: 240_000,
  startingFailures: 12,
  // Shared across processes through the restart lock file: clients that see a completed reboot wait
  // out this cooldown before starting their own, and abandon a lock whose owner died or stalled.
  restartCooldown: 30_000,
  restartLockStale: 600_000,
}

export function ensureTiming(options: object) {
  return timings.get(options) ?? defaultEnsureTiming
}

/** Pick the timeout streak that escalates an unresponsive owner, based on its advertised state. */
export function unresponsiveThreshold(timing: EnsureTiming, starting: boolean) {
  return starting
    ? { window: timing.startingWindow, failures: timing.startingFailures }
    : { window: timing.unresponsiveWindow, failures: timing.unresponsiveFailures }
}

// Keep test timing out of the public lifecycle option types.
export function withEnsureTiming<A extends object>(options: A, overrides: Partial<EnsureTiming>): A {
  timings.set(options, { ...defaultEnsureTiming, ...overrides })
  return options
}
