export type RecoveryReason =
  | "focus"
  | "global-disposed"
  | "notification-open"
  | "online"
  | "pageshow"
  | "server-connected"
  | "visibility"

type PendingRecovery = {
  reasons: RecoveryReason[]
  force: boolean
}

export function createRecoveryCoordinator(input: {
  delayMs?: number
  run: (input: {
    reason: RecoveryReason
    reasons: RecoveryReason[]
    force: boolean
    lastRecoveredAt: number
  }) => Promise<void> | void
}) {
  const delayMs = input.delayMs ?? 250
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let pending: PendingRecovery | undefined
  let lastRecoveredAt = 0

  const stopTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, delayMs)
  }

  const merge = (reason: RecoveryReason, force: boolean) => {
    if (!pending) {
      pending = { reasons: [reason], force }
      return
    }
    if (!pending.reasons.includes(reason)) {
      pending.reasons = [...pending.reasons, reason]
    }
    if (force) pending.force = true
  }

  const run = () => {
    if (running) return running
    if (!pending) return Promise.resolve()

    const next = pending
    pending = undefined
    const reason = next.reasons[next.reasons.length - 1]
    if (!reason) return Promise.resolve()

    running = Promise.resolve(
      input.run({
        reason,
        reasons: next.reasons,
        force: next.force,
        lastRecoveredAt,
      }),
    ).finally(() => {
      lastRecoveredAt = Date.now()
      running = undefined
      if (pending) schedule()
    })

    return running
  }

  return {
    get lastRecoveredAt() {
      return lastRecoveredAt
    },
    trigger(input: { reason: RecoveryReason; force?: boolean }) {
      merge(input.reason, input.force === true)
      if (running || timer) return running ?? Promise.resolve()
      schedule()
      return Promise.resolve()
    },
    flush() {
      stopTimer()
      if (running) return running
      return run()
    },
    dispose() {
      stopTimer()
      pending = undefined
    },
  }
}
