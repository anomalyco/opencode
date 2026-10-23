/**
 * Human-in-the-loop handoff registry.
 *
 * A running execute script can call `await handoff("Complete the 2FA prompt")`.
 * The sandbox registers a pending handoff for its OpenCode Browser session and
 * exact tab, then blocks until the in-page completion control sends the
 * matching handoff id or the timeout elapses.
 */

export type HandoffCancellationReason = "target-detached" | "target-crashed"

export type HandoffOutcome =
  | "resolved"
  | "timeout"
  | { readonly type: "cancelled"; readonly reason: HandoffCancellationReason }

type PendingHandoff = {
  readonly id: string
  readonly sessionId: string
  readonly tabId: number
  targetId: string
  targetSessionId: string
  readonly message: string
  readonly resolve: (outcome: HandoffOutcome) => void
}

export type HandoffWait = {
  readonly id: string
  readonly outcome: Promise<HandoffOutcome>
  /** End the wait as a timeout if it is still pending. */
  readonly cancel: () => void
  /** Defer human completion once, keeping the deadline and target cancellation live while a start action settles. */
  readonly holdCompletion: () => () => void
}

export async function awaitHandoffAction(options: {
  readonly wait: HandoffWait
  readonly present?: () => Promise<void>
  readonly start?: () => unknown | Promise<unknown>
  readonly cancelStart?: () => Promise<void>
}): Promise<HandoffOutcome> {
  const { wait } = options
  const outcome = wait.outcome.then((value) => ({ type: "handoff-completed" as const, value }))
  if (options.present) {
    const presentation = options.present().then(
      () => ({ type: "presented" as const }),
      (error: unknown) => ({ type: "presentation-failed" as const, error }),
    )
    const first = await Promise.race([presentation, outcome])
    if (first.type === "handoff-completed") return first.value
    if (first.type === "presentation-failed") {
      wait.cancel()
      throw first.error
    }
  }
  if (!options.start) return await wait.outcome
  const releaseCompletion = wait.holdCompletion()
  const action = Promise.resolve().then(options.start).then(
    () => {
      releaseCompletion()
      return { type: "action-completed" as const }
    },
    (error: unknown) => ({ type: "action-failed" as const, error }),
  )
  const first = await Promise.race([action, outcome])
  if (first.type === "action-failed") {
    wait.cancel()
    throw first.error
  }
  if (first.type === "action-completed") return await wait.outcome
  // A human completion delivered before the hold still lets the action settle.
  if (first.value === "resolved" || !options.cancelStart) {
    const actionResult = await action
    if (actionResult.type === "action-failed") throw actionResult.error
  } else {
    await options.cancelStart()
  }
  return first.value
}

export type PendingHandoffView = {
  readonly id: string
  readonly sessionId: string
  readonly tabId: number
  readonly targetId: string
  readonly targetSessionId: string
  readonly message: string
}

export type ToolbarClickAction = "ignore" | "toggle"

export function toolbarClickAction(options: {
  readonly handoffPending: boolean
  readonly sessionExecuting: boolean
}): ToolbarClickAction {
  return options.handoffPending || options.sessionExecuting ? "ignore" : "toggle"
}

export class HandoffRegistry {
  private readonly pending = new Map<string, PendingHandoff>()

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}

  /**
   * Register a pending handoff for a session. Only one handoff can be pending
   * per session (execute calls are serialized per session). Returns its unique
   * id and an outcome promise.
   */
  wait(options: {
    readonly sessionId: string
    readonly tabId: number
    readonly targetId: string
    readonly targetSessionId: string
    readonly message: string
    readonly timeoutMs: number
  }): HandoffWait {
    const existing = this.pending.get(options.sessionId)
    if (existing) {
      existing.resolve("timeout")
    }
    const id = this.createId()
    let held = false
    let humanCompleted = false
    let finish: (outcome: HandoffOutcome) => void
    const outcome = new Promise<HandoffOutcome>((resolvePromise) => {
      let pending: PendingHandoff
      const timeout = setTimeout(() => finish("timeout"), options.timeoutMs)
      finish = (outcome) => {
        clearTimeout(timeout)
        if (this.pending.get(options.sessionId) === pending) {
          this.pending.delete(options.sessionId)
        }
        resolvePromise(outcome)
      }
      pending = {
        id,
        sessionId: options.sessionId,
        tabId: options.tabId,
        targetId: options.targetId,
        targetSessionId: options.targetSessionId,
        message: options.message,
        resolve: (outcome) => {
          if (outcome === "resolved" && held) {
            humanCompleted = true
            return
          }
          finish(outcome)
        },
      }
      this.pending.set(options.sessionId, pending)
    })
    return {
      id,
      outcome,
      cancel: () => {
        this.cancel(id)
      },
      holdCompletion: () => {
        held = true
        return () => {
          if (!held) return
          held = false
          if (humanCompleted) finish("resolved")
        }
      },
    }
  }

  /** Resolve only the waiter named by its token and exact registry target. */
  complete(options: {
    readonly id: string
    readonly tabId: number
    readonly targetId: string
    readonly targetSessionId: string
  }): boolean {
    const pending = Array.from(this.pending.values()).find((candidate) => candidate.id === options.id)
    if (
      !pending ||
      pending.tabId !== options.tabId ||
      pending.targetId !== options.targetId ||
      pending.targetSessionId !== options.targetSessionId
    ) {
      return false
    }
    pending.resolve("resolved")
    return true
  }

  cancel(id: string): boolean {
    const pending = Array.from(this.pending.values()).find((candidate) => candidate.id === id)
    if (!pending) return false
    pending.resolve("timeout")
    return true
  }

  pendingForSession(sessionId: string): PendingHandoffView | undefined {
    return this.view(this.pending.get(sessionId))
  }

  pendingForTab(tabId: number): PendingHandoffView | undefined {
    return this.view(Array.from(this.pending.values()).find((pending) => pending.tabId === tabId))
  }

  get pendingCount(): number {
    return this.pending.size
  }

  rebindTarget(options: {
    readonly tabId: number
    readonly previousTargetId: string
    readonly previousTargetSessionId: string
    readonly targetId: string
    readonly targetSessionId: string
  }): boolean {
    const pending = Array.from(this.pending.values()).find((candidate) => {
      return candidate.tabId === options.tabId &&
        candidate.targetId === options.previousTargetId &&
        candidate.targetSessionId === options.previousTargetSessionId
    })
    if (!pending) return false
    pending.targetId = options.targetId
    pending.targetSessionId = options.targetSessionId
    return true
  }

  cancelForTarget(options: {
    readonly targetId: string
    readonly targetSessionId: string
    readonly reason: HandoffCancellationReason
  }): readonly PendingHandoffView[] {
    const matching = Array.from(this.pending.values()).filter((pending) => {
      return pending.targetId === options.targetId && pending.targetSessionId === options.targetSessionId
    })
    const cancelled = matching.map((pending) => this.view(pending)).filter((pending) => pending !== undefined)
    for (const pending of matching) {
      pending.resolve({ type: "cancelled", reason: options.reason })
    }
    return cancelled
  }

  /** Cancel every pending handoff, resolving waiters as timeouts. */
  cancelAll(): void {
    for (const pending of Array.from(this.pending.values())) {
      pending.resolve("timeout")
    }
    this.pending.clear()
  }

  private view(pending: PendingHandoff | undefined): PendingHandoffView | undefined {
    if (!pending) {
      return undefined
    }
    return {
      id: pending.id,
      sessionId: pending.sessionId,
      tabId: pending.tabId,
      targetId: pending.targetId,
      targetSessionId: pending.targetSessionId,
      message: pending.message,
    }
  }
}

export function resolveExactHandoffTarget<T extends {
  readonly tabId: number
  readonly sessionId: string
  readonly targetInfo: { readonly targetId: string }
}>(options: {
  readonly targetId: string
  readonly targets: readonly T[]
  readonly isVisible: (target: T) => boolean
}): T {
  const target = options.targets.find((candidate) => candidate.targetInfo.targetId === options.targetId)
  if (!target || !options.isVisible(target)) {
    throw new Error("Could not bind handoff to the selected page; its target detached or is no longer visible")
  }
  return target
}
