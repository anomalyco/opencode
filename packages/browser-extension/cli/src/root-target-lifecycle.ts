import { Effect, Exit, Latch, Schedule, Schema, Scope, Semaphore } from "effect"
import type { CdpClientPool } from "./cdp-client-pool.ts"
import { ghostCursorClientSource } from "./ghost-cursor.ts"
import type { HandoffRegistry } from "./handoff.ts"
import type { ExtensionCommand, JsonObject } from "./protocol.ts"
import { getTargetInfo } from "./relay-helpers.ts"
import type { ChildTarget, ConnectedTarget } from "./relay-types.ts"
import type { OpenCodeBrowserSessions } from "./session-manager.ts"
import { shouldExposeChildTarget, type RootTargetChange, type TargetRegistry } from "./target-registry.ts"

type AttachOptions = {
  readonly tabId: number
  readonly owner: "relay" | "user"
  readonly opencodeBrowserSessionId?: string
  readonly alreadyAttached?: boolean
  readonly expectedExtensionGeneration?: number
  readonly autoAttachParams?: JsonObject
}

type Options = {
  readonly registry: TargetRegistry
  readonly sessions: Pick<OpenCodeBrowserSessions, "persistedTargetOwner" | "markTargetReplaced">
  readonly handoffs: Pick<HandoffRegistry, "rebindTarget">
  readonly clients: Pick<CdpClientPool<object>, "detachTab">
  readonly extension: {
    readonly generation: () => number
    readonly send: (command: Omit<ExtensionCommand, "id">) => Effect.Effect<JsonObject, Error>
  }
  readonly presentation: {
    readonly replaced: (change: Extract<RootTargetChange, { readonly kind: "replaced" }>) => void
    readonly committed: (target: ConnectedTarget) => void
    readonly announceRoot: (target: ConnectedTarget) => void
    readonly announceChild: (rootSessionId: string, target: ChildTarget) => void
  }
  readonly reportError: (message: string, error: unknown) => void
}

type TabWork = { readonly semaphore: Semaphore.Semaphore; revision: number; users: number }
type Transition = {
  readonly tabId: number
  readonly generation: number
  readonly work: TabWork
  readonly revision: number
  root: ConnectedTarget | undefined
  staged: ConnectedTarget | undefined
}
type Worker = {
  readonly generation: number
  readonly done: Latch.Latch
  attachIfMissing: boolean
  pending: boolean
  verificationRetries: number
}

class GenerationChanged extends Schema.TaggedError<GenerationChanged>()("RootTargetLifecycle.GenerationChanged", {
  message: Schema.String,
}) {}

/** Owns root setup and replacement, not target ownership or client announcement indexes. */
export class RootTargetLifecycle {
  static readonly make = Effect.fn("RootTargetLifecycle.make")(function* (options: Options) {
    const scope = yield* Scope.make()
    const run = Effect.runForkWith(yield* Effect.context())
    return yield* Effect.acquireRelease(
      Effect.sync(() => new RootTargetLifecycle(options, scope, run)),
      (lifecycle) => lifecycle.close(),
    )
  })

  private readonly tabs = new Map<number, TabWork>()
  private readonly workers = new Map<string, Worker>()
  private readonly idle = Latch.makeUnsafe(true)
  private active = 0
  private closing = false
  private readonly failedTabs = new Map<number, number>()
  private nextSessionId = 1

  private constructor(
    private readonly options: Options,
    private readonly scope: Scope.Closeable,
    private readonly run: ReturnType<typeof Effect.runForkWith<never>>,
  ) {}

  isIdle(): boolean {
    return this.active === 0 && this.workers.size === 0
  }

  /** Invalidate in-flight work before removing a tab, including a not-yet-staged attach. */
  invalidate(tabId: number): void {
    const work = this.tabs.get(tabId)
    if (work) work.revision += 1
    this.failedTabs.delete(tabId)
  }

  readonly attach = Effect.fn("RootTargetLifecycle.attach")((options: AttachOptions) =>
    this.withPermit(options.tabId, options.expectedExtensionGeneration, (transition) => this.attachUnlocked(transition, options)))

  readonly reconcile = Effect.fn("RootTargetLifecycle.reconcile")((tabId: number, generation?: number) =>
    this.withPermit(tabId, generation, (transition) => this.reconcileUnlocked(transition)))

  queue(options: {
    readonly tabId: number
    readonly attachIfMissing: boolean
    readonly verificationRetries: number
    readonly errorMessage: string
    readonly generation?: number
  }): void {
    if (this.closing) return
    const lifecycle = this
    const generation = options.generation ?? this.options.extension.generation()
    if (generation !== this.options.extension.generation()) return
    for (const [tabId, failedGeneration] of this.failedTabs) {
      if (failedGeneration !== generation) this.failedTabs.delete(tabId)
    }
    const work = this.tabWork(options.tabId)
    const revision = work.revision
    const key = `${generation}:${options.tabId}:${revision}`
    const existing = this.workers.get(key)
    if (existing) {
      existing.pending = true
      existing.attachIfMissing ||= options.attachIfMissing
      existing.verificationRetries = Math.max(existing.verificationRetries, options.verificationRetries)
      return
    }
    work.users += 1
    const worker: Worker = {
      generation,
      done: Latch.makeUnsafe(),
      attachIfMissing: options.attachIfMissing,
      pending: false,
      verificationRetries: options.verificationRetries,
    }
    this.workers.set(key, worker)
    const pass = Effect.gen(function* () {
      worker.pending = false
      const mayAttach = worker.attachIfMissing
      worker.attachIfMissing = false
      yield* Effect.suspend(() => {
        if (revision !== work.revision) return new GenerationChanged({ message: "Tab detached during root reconciliation" })
        return lifecycle.withPermit(options.tabId, generation, (transition) => {
          if (lifecycle.options.registry.routingRootTarget(options.tabId)) return lifecycle.reconcileUnlocked(transition)
          return mayAttach
            ? lifecycle.attachUnlocked(transition, { tabId: options.tabId, owner: "user", alreadyAttached: true }).pipe(Effect.asVoid)
            : Effect.void
        })
      }).pipe(
        Effect.tapError((error) => Effect.sync(() => lifecycle.options.reportError(options.errorMessage, error))),
        Effect.retry({
          times: 2,
          schedule: Schedule.spaced(0).pipe(Schedule.modifyDelay(({ attempt }) => Effect.succeed(100 * attempt))),
          while: (error) => !(error instanceof GenerationChanged) && !lifecycle.closing && generation === lifecycle.options.extension.generation() && revision === work.revision,
        }),
      )
      if (lifecycle.closing || generation !== lifecycle.options.extension.generation()) return null
      if (worker.verificationRetries > 0) {
        const delay = 50 * (4 - worker.verificationRetries)
        worker.verificationRetries -= 1
        return delay
      }
      return worker.pending ? 0 : null
    }).pipe(
      Effect.repeat({
        while: (delay) => delay !== null && !lifecycle.closing,
        schedule: Schedule.spaced(0).pipe(
          Schedule.setInputType<number | null>(),
          Schedule.modifyDelay(({ input }) => Effect.succeed(input ?? 0)),
        ),
      }),
      Effect.onExit((exit) => Effect.sync(() => {
        if (generation === lifecycle.options.extension.generation() && revision === work.revision) {
          if (Exit.isFailure(exit)) lifecycle.failedTabs.set(options.tabId, generation)
          else lifecycle.failedTabs.delete(options.tabId)
        }
        lifecycle.workers.delete(key)
        if (--work.users === 0 && !lifecycle.options.registry.routingRootTarget(options.tabId)) lifecycle.tabs.delete(options.tabId)
        worker.done.openUnsafe()
      })),
    )
    // The scope is closed only after settlement; queued browser work is never interrupted by drain.
    this.run(pass.pipe(Effect.forkIn(this.scope)))
  }

  /** Readiness retains failed inventory results even when a worker finished before `ready`. */
  readonly settle = Effect.fn("RootTargetLifecycle.settle")(function* (this: RootTargetLifecycle, generation?: number) {
    while (true) {
      const workers = Array.from(this.workers.values()).filter((worker) => generation === undefined || worker.generation === generation)
      yield* Effect.forEach(workers, (worker) => worker.done.await, { concurrency: "unbounded", discard: true })
      if (generation === undefined) yield* this.idle.await
      if (!Array.from(this.workers.values()).some((worker) => generation === undefined || worker.generation === generation)) break
    }
    return generation === undefined || (generation === this.options.extension.generation() && !Array.from(this.failedTabs.values()).includes(generation))
  })

  readonly close = Effect.fn("RootTargetLifecycle.close")(function* (this: RootTargetLifecycle) {
    this.closing = true
    yield* this.settle()
    yield* Scope.close(this.scope, Exit.void)
    this.tabs.clear()
  })

  private withPermit<A>(tabId: number, expectedGeneration: number | undefined, use: (transition: Transition) => Effect.Effect<A, Error>): Effect.Effect<A, Error> {
    const lifecycle = this
    return Effect.suspend(() => {
      if (lifecycle.closing) return Effect.fail(new Error("Relay is closing"))
      const generation = expectedGeneration ?? lifecycle.options.extension.generation()
      const work = lifecycle.tabWork(tabId)
      const revision = work.revision
      work.users += 1
      lifecycle.active += 1
      lifecycle.idle.closeUnsafe()
      return work.semaphore.withPermit(Effect.suspend(() => {
        const transition: Transition = {
          tabId, generation, work, revision,
          root: lifecycle.options.registry.tabTargets.get(tabId),
          staged: lifecycle.options.registry.stagedRootTarget(tabId),
        }
        return lifecycle.check(transition).pipe(Effect.andThen(() => use(transition)))
      })).pipe(Effect.ensuring(Effect.sync(() => {
        if (--work.users === 0 && !lifecycle.options.registry.routingRootTarget(tabId)) lifecycle.tabs.delete(tabId)
        if (--lifecycle.active === 0) lifecycle.idle.openUnsafe()
      })))
    })
  }

  private tabWork(tabId: number): TabWork {
    const work = this.tabs.get(tabId) ?? { semaphore: Semaphore.makeUnsafe(1), revision: 0, users: 0 }
    this.tabs.set(tabId, work)
    return work
  }

  private readonly check = Effect.fnUntraced(function* (this: RootTargetLifecycle, transition: Transition) {
    const { registry, extension } = this.options
    const root = registry.tabTargets.get(transition.tabId)
    const staged = registry.stagedRootTarget(transition.tabId)
    if (
      transition.generation !== extension.generation() || transition.revision !== transition.work.revision ||
      transition.root?.sessionId !== root?.sessionId || transition.root?.targetInfo.targetId !== root?.targetInfo.targetId ||
      transition.staged?.sessionId !== staged?.sessionId || transition.staged?.targetInfo.targetId !== staged?.targetInfo.targetId
    ) return yield* new GenerationChanged({ message: "Root target generation changed during reconciliation" })
  })

  private step<A>(transition: Transition, effect: Effect.Effect<A, Error>): Effect.Effect<A, Error> {
    return this.check(transition).pipe(
      Effect.andThen(effect),
      Effect.catch((error) => this.check(transition).pipe(Effect.andThen(Effect.fail(error)))),
      Effect.tap(() => this.check(transition)),
    )
  }

  private command(transition: Transition, method: string, params: JsonObject = {}): Effect.Effect<JsonObject, Error> {
    return this.step(transition, this.options.extension.send({ method: "debugger.sendCommand", params: { tabId: transition.tabId, method, params } }))
  }

  private readonly attachUnlocked = Effect.fnUntraced(function* (this: RootTargetLifecycle, transition: Transition, options: AttachOptions) {
    const { tabId } = transition
    if (!options.alreadyAttached) yield* this.step(transition, this.options.extension.send({ method: "debugger.attach", params: { tabId } }))
    yield* this.command(transition, "Page.enable")
    yield* Effect.gen({ self: this }, function* () {
      yield* this.command(transition, "Emulation.setFocusEmulationEnabled", { enabled: true })
      yield* this.command(transition, "Page.addScriptToEvaluateOnNewDocument", { source: ghostCursorClientSource })
      yield* this.command(transition, "Runtime.evaluate", { expression: ghostCursorClientSource })
    }).pipe(Effect.ignore)
    yield* this.check(transition)
    const result = yield* this.command(transition, "Target.getTargetInfo")
    const targetInfo = getTargetInfo(result.targetInfo)
    if (!targetInfo) return yield* Effect.fail(new Error("Target.getTargetInfo did not return targetInfo"))
    const restored = options.opencodeBrowserSessionId ? undefined : this.options.sessions.persistedTargetOwner(targetInfo.targetId)
    const opencodeBrowserSessionId = options.opencodeBrowserSessionId ?? restored?.sessionId
    const target = this.options.registry.stageRootTarget({
      tabId,
      sessionId: `bc-tab-${this.nextSessionId++}`,
      targetInfo,
      owner: restored?.owner ?? options.owner,
      ...(opencodeBrowserSessionId ? { opencodeBrowserSessionId } : {}),
    })
    transition.staged = target
    return yield* this.finish(transition, target, options.autoAttachParams)
  })

  private readonly reconcileUnlocked = Effect.fnUntraced(function* (this: RootTargetLifecycle, transition: Transition) {
    const { registry } = this.options
    const expected = registry.tabTargets.get(transition.tabId)
    const staged = registry.stagedRootTarget(transition.tabId)
    if (!expected && !staged) return
    const result = yield* this.command(transition, "Target.getTargetInfo").pipe(
      Effect.retry({ times: 1, schedule: Schedule.spaced(50), while: (error) => !(error instanceof GenerationChanged) }),
    )
    yield* this.check(transition)
    const targetInfo = getTargetInfo(result.targetInfo)
    if (!targetInfo) {
      return yield* Effect.fail(new Error(staged ? "Unable to verify staged root target" : "Unable to verify committed root target"))
    }
    if (staged?.targetInfo.targetId === targetInfo.targetId) {
      yield* this.finish(transition, staged)
      return
    }
    if (!staged && expected?.targetInfo.targetId === targetInfo.targetId) return
    const owner = expected ?? staged
    if (!owner) return
    yield* this.attachUnlocked(transition, {
      tabId: transition.tabId, owner: owner.owner, alreadyAttached: true,
      ...(owner.opencodeBrowserSessionId ? { opencodeBrowserSessionId: owner.opencodeBrowserSessionId } : {}),
    })
  })

  private readonly finish = Effect.fnUntraced(function* (this: RootTargetLifecycle, transition: Transition, target: ConnectedTarget, autoAttachParams?: JsonObject) {
    const { registry, handoffs, sessions, clients, presentation } = this.options
    // Stage before auto-attach: synchronous child events must route to this generation.
    yield* this.command(transition, "Target.setAutoAttach", autoAttachParams ?? { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    const result = yield* this.command(transition, "Target.getTargetInfo")
    if (getTargetInfo(result.targetInfo)?.targetId !== target.targetInfo.targetId) {
      return yield* Effect.fail(new Error(`Root target changed while preparing ${target.targetInfo.targetId}`))
    }
    const change = registry.commitStagedRootTarget(target.tabId, target.sessionId)
    if (!change) return yield* Effect.fail(new Error(`Staged root target changed before commit: ${target.targetInfo.targetId}`))
    transition.root = change.target
    transition.staged = undefined
    if (change.kind === "replaced") {
      handoffs.rebindTarget({
        tabId: target.tabId,
        previousTargetId: change.previous.targetInfo.targetId,
        previousTargetSessionId: change.previous.sessionId,
        targetId: change.target.targetInfo.targetId,
        targetSessionId: change.target.sessionId,
      })
      sessions.markTargetReplaced(change.previous.targetInfo.targetId, change.target.targetInfo.targetId)
      clients.detachTab(target.tabId)
      presentation.replaced(change)
    }
    // No asynchronous gap between retiring old views and publishing the committed tree.
    presentation.committed(change.target)
    presentation.announceRoot(change.target)
    for (const child of registry.childTargets.values()) {
      if (child.tabId === target.tabId && child.parentSessionId === change.target.sessionId && shouldExposeChildTarget(child)) {
        presentation.announceChild(change.target.sessionId, child)
      }
    }
    yield* this.step(transition, this.options.extension.send({ method: "action.setAttached", params: { tabId: target.tabId, attached: true } }).pipe(Effect.ignore))
    return change.target
  })
}
