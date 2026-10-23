import { Deferred, Effect, Fiber, Predicate } from "effect"
import type { CdpRoutedSession } from "./cdp-router.ts"
import type { CdpEvent, JsonObject } from "./protocol.ts"
import { getNumber, getObject, getString } from "./relay-helpers.ts"
import { boundedToken, runtimeFailureKind } from "./runtime-diagnostics.ts"
import type { TargetRegistry } from "./target-registry.ts"

const maxCachedContexts = 512

type Waiter = {
  readonly sessionId: string
  readonly ready: Deferred.Deferred<boolean>
  readonly nativeReady: (event: CdpEvent) => boolean
  /** Installed once the enable command succeeds. */
  replay?: () => boolean
}

type Contexts = Map<number, CdpEvent>
/** `contexts` is undefined once the cache overflowed and can no longer prove completeness. */
type ContextCache = { readonly current: () => boolean; contexts: Contexts | undefined }
type Requester = {
  readonly current: () => boolean
  readonly delivered: Map<number, string | undefined>
  frameId?: string
}

const routeSessionId = (route: CdpRoutedSession) => route.chromeSessionId ?? route.rootSessionId
const disableKey = (tabId: number, chromeSessionId?: string) => `${tabId}:${chromeSessionId ?? "root"}`
const contextAux = (event: CdpEvent) => getObject(getObject(event.params?.context)?.auxData)

export class CdpRuntime<Client extends object> {
  private readonly waiters = new Set<Waiter>()
  private readonly contexts = new Map<string, ContextCache>()
  private readonly requesters = new WeakMap<Client, Map<string, Requester>>()
  private readonly disabling = new Map<string, number>()

  constructor(private readonly options: {
    readonly registry: TargetRegistry
    readonly generation: () => number
    readonly send: (command: { readonly tabId: number; readonly sessionId?: string; readonly method: string; readonly params: JsonObject }) => Effect.Effect<JsonObject, Error>
    readonly sendEvent: (client: Client, event: CdpEvent) => void
    readonly trace?: (message: string) => void
  }) {}

  notify(event: CdpEvent): void {
    if (event.sessionId) this.recordContextEvent(event.sessionId, event)
    if (event.method !== "Runtime.executionContextCreated" || contextAux(event)?.isDefault !== true) return
    // Replay missing sibling contexts before waking the native waiter: resolving
    // its Deferred can synchronously retire the waiter's pending replay.
    for (const waiter of this.waiters) this.settle(waiter)
    for (const waiter of this.waiters) {
      if (waiter.sessionId === event.sessionId && waiter.nativeReady(event)) Deferred.doneUnsafe(waiter.ready, Effect.succeed(true))
    }
  }

  /** Observe the exact events actually sent to this canonical client. Aliases never enter here. */
  deliver(client: Client, event: CdpEvent): void {
    const requester = event.sessionId ? this.requesters.get(client)?.get(event.sessionId) : undefined
    const active = requester?.current() ? requester : undefined
    const context = getObject(event.params?.context)
    const id = getNumber(context, "id")
    const destroyedId = getNumber(event.params, "executionContextId")
    if (event.method === "Runtime.executionContextsCleared") active?.delivered.clear()
    if (event.method === "Runtime.executionContextDestroyed" && destroyedId !== undefined) {
      active?.delivered.delete(destroyedId)
    }
    if (event.method === "Runtime.executionContextCreated" && active?.frameId !== undefined && id !== undefined) {
      const unique = getString(context, "uniqueId")
      if (active.delivered.has(id) && active.delivered.get(id) === unique) return
      active.delivered.set(id, unique)
    }
    this.options.sendEvent(client, event)
  }

  /** Construct at request admission; invoke with the result only after its successful response is sent. */
  frameTreeResponse(client: Client, route: CdpRoutedSession, canContinue: () => boolean): (result: unknown) => void {
    const requester = this.requester(client, route, canContinue)
    return (result) => {
      const frameId = getString(getObject(getObject(getObject(result)?.frameTree)?.frame), "id")
      if (!Predicate.isString(frameId) || !requester.current()) return
      requester.frameId = frameId
      for (const waiter of this.waiters) this.settle(waiter)
    }
  }

  disconnect(client: Client): void {
    this.requesters.delete(client)
  }

  detach(client: Client, sessionId: string): void {
    this.requesters.get(client)?.delete(sessionId)
  }

  beginDisable(tabId: number, chromeSessionId?: string): () => void {
    const key = disableKey(tabId, chromeSessionId)
    this.disabling.set(key, (this.disabling.get(key) ?? 0) + 1)
    this.invalidate(tabId, chromeSessionId)
    return () => {
      const count = (this.disabling.get(key) ?? 1) - 1
      if (count === 0) this.disabling.delete(key)
      else this.disabling.set(key, count)
    }
  }

  private recordContextEvent(sessionId: string, event: CdpEvent): void {
    if (!event.method.startsWith("Runtime.executionContext") && event.method !== "Page.frameDetached") return
    const cache = this.cacheFor(sessionId)
    if (!cache) return
    switch (event.method) {
      case "Runtime.executionContextsCleared":
        cache.contexts = new Map()
        return
      case "Runtime.executionContextDestroyed": {
        const id = getNumber(event.params, "executionContextId")
        if (id !== undefined) cache.contexts?.delete(id)
        return
      }
      case "Page.frameDetached":
        for (const [id, created] of cache.contexts ?? []) {
          if (contextAux(created)?.frameId === event.params?.frameId) cache.contexts?.delete(id)
        }
        return
      case "Runtime.executionContextCreated": {
        const id = getNumber(getObject(event.params?.context), "id")
        if (!cache.contexts || id === undefined) return
        cache.contexts.set(id, event)
        if (cache.contexts.size > maxCachedContexts) cache.contexts = undefined
      }
    }
  }

  private invalidate(tabId: number, chromeSessionId?: string): void {
    for (const [sessionId] of this.contexts) {
      const target = this.options.registry.targets.get(sessionId) ?? this.options.registry.childTargets.get(sessionId)
      if (target?.tabId === tabId && (chromeSessionId === undefined || sessionId === chromeSessionId)) this.contexts.delete(sessionId)
    }
  }

  private cacheFor(sessionId: string): ContextCache | undefined {
    for (const [key, value] of this.contexts) if (!value.current()) this.contexts.delete(key)
    const root = this.options.registry.targets.get(sessionId)
    const child = this.options.registry.childTargets.get(sessionId)
    const parent = child ? this.options.registry.tabTargets.get(child.tabId) : undefined
    const route = root ? { tabId: root.tabId, rootSessionId: root.sessionId }
      : child && parent ? { tabId: child.tabId, rootSessionId: parent.sessionId, chromeSessionId: child.sessionId } : undefined
    if (!route) return undefined
    if (this.disabling.has(disableKey(route.tabId)) || this.disabling.has(disableKey(route.tabId, route.chromeSessionId))) return undefined
    let cache = this.contexts.get(sessionId)
    if (!cache) {
      cache = { current: this.capture(route), contexts: new Map() }
      this.contexts.set(sessionId, cache)
    }
    return cache
  }

  private requester(client: Client, route: CdpRoutedSession, canContinue: () => boolean): Requester {
    const sessions = this.requesters.get(client) ?? new Map<string, Requester>()
    this.requesters.set(client, sessions)
    const sessionId = routeSessionId(route)
    const existing = sessions.get(sessionId)
    if (existing?.current()) return existing
    const captured = this.capture(route)
    const next: Requester = {
      current: () => captured() && canContinue() && this.requesters.get(client) === sessions && sessions.get(sessionId) === next,
      delivered: new Map(),
    }
    sessions.set(sessionId, next)
    return next
  }

  readonly enable = Effect.fn("CdpRuntime.enable")(function* (
    this: CdpRuntime<Client>,
    route: CdpRoutedSession,
    params: JsonObject,
    canContinue: () => boolean,
    client?: Client,
  ) {
    const current = this.capture(route)
    const permitted = () => current() && canContinue()
    // Raw CDP clients need not request a frame tree. Preserve their ordinary
    // native-event path; cached replay requires a frame-tree request already admitted.
    const requester = client ? this.requesters.get(client)?.get(routeSessionId(route)) : undefined
    const rootFrame = () => requester && permitted() && requester.current() ? requester.frameId : undefined
    const first = yield* this.observe(route, Effect.suspend(() => permitted()
      ? this.options.send({
        tabId: route.tabId, method: "Runtime.enable", params,
        ...(route.chromeSessionId === undefined ? {} : { sessionId: route.chromeSessionId }),
      })
      : Effect.fail(new Error("CDP target changed before Runtime.enable"))), client && requester ? {
      replay: () => {
        const frameId = rootFrame()
        return frameId !== undefined && this.replayCached(client, route, frameId)
      },
      nativeReady: (event) => {
        const frameId = rootFrame()
        return frameId !== undefined && contextAux(event)?.frameId === frameId
      },
    } : {})
    this.trace(route, `runtime-enable defaultContextSeen=${first.seen}`)
    if (!first.seen && permitted()) {
      // The shared debugger may acknowledge enable without replaying its context.
      // Never run the recovery cycle against a successor generation or new owner.
      const retry = yield* this.observe(route, this.reset(route, "Runtime.disable", {}, permitted).pipe(
        Effect.andThen(() => this.reset(route, "Runtime.enable", params, permitted)),
      ))
      this.trace(route, `runtime-reset phase=missing-default-context defaultContextSeen=${retry.seen}`)
    }
    return first.result
  })

  readonly disableIdle = Effect.fn("CdpRuntime.disableIdle")(function* (this: CdpRuntime<Client>, stillIdle: () => boolean) {
    const { registry } = this.options
    const routes: CdpRoutedSession[] = registry.listRootTargets().map((target) => ({ tabId: target.tabId, rootSessionId: target.sessionId }))
    for (const target of registry.childTargets.values()) {
      const root = registry.tabTargets.get(target.tabId)
      if (root) routes.push({ tabId: target.tabId, rootSessionId: root.sessionId, chromeSessionId: target.sessionId })
    }
    const targets = routes.map((route) => ({ route, current: this.capture(route) }))
    for (const { route, current } of targets) {
      if (!stillIdle()) break
      yield* this.reset(route, "Runtime.disable", {}, () => stillIdle() && current())
    }
  })

  /** Replay a complete cache only when it already holds the requester's root-frame default context. */
  private replayCached(client: Client, route: CdpRoutedSession, frameId: string): boolean {
    const cache = this.contexts.get(routeSessionId(route))
    const contexts = cache?.current() ? cache.contexts : undefined
    if (!contexts || ![...contexts.values()].some((event) => {
      const aux = contextAux(event)
      return aux?.isDefault === true && aux.frameId === frameId
    })) return false
    for (const event of contexts.values()) this.deliver(client, event)
    this.trace(route, "runtime-replay defaultContextSeen=true")
    return true
  }

  private settle(waiter: Waiter): void {
    if (waiter.replay?.()) Deferred.doneUnsafe(waiter.ready, Effect.succeed(true))
  }

  private observe<A>(route: CdpRoutedSession, command: Effect.Effect<A, Error>, options: {
    readonly replay?: () => boolean
    readonly nativeReady?: (event: CdpEvent) => boolean
  } = {}): Effect.Effect<{ readonly result: A; readonly seen: boolean }, Error> {
    const runtime = this
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const waiter: Waiter = { sessionId: routeSessionId(route), ready: Deferred.makeUnsafe(), nativeReady: options.nativeReady ?? (() => true) }
        runtime.waiters.add(waiter)
        return waiter
      }),
      (waiter) => Effect.gen(function* () {
        // Start the window before sending: context events may precede the reply.
        const seen = yield* Effect.forkScoped(Deferred.await(waiter.ready).pipe(Effect.timeoutOrElse({
          duration: "3 seconds",
          orElse: () => Effect.succeed(false),
        })), { startImmediately: true })
        const result = yield* command
        if (options.replay) waiter.replay = options.replay
        runtime.settle(waiter)
        return { result, seen: yield* Fiber.join(seen) }
      }).pipe(Effect.scoped),
      (waiter) => Effect.sync(() => { runtime.waiters.delete(waiter) }),
    )
  }

  private reset(route: CdpRoutedSession, method: "Runtime.enable" | "Runtime.disable", params: JsonObject, current: () => boolean): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (!current()) return Effect.void
      this.trace(route, `runtime-reset command=${method}`)
      return this.options.send({ tabId: route.tabId, method, params, ...(route.chromeSessionId === undefined ? {} : { sessionId: route.chromeSessionId }) }).pipe(
        Effect.match({
          onFailure: (error) => this.trace(route, `runtime-reset command=${method} outcome=failed failure=${runtimeFailureKind(error)}`),
          onSuccess: () => this.trace(route, `runtime-reset command=${method} outcome=ok`),
        }),
      )
    })
  }

  private capture(route: CdpRoutedSession): () => boolean {
    const { registry } = this.options
    const generation = this.options.generation()
    const root = registry.targets.get(route.rootSessionId)
    const owner = root?.opencodeBrowserSessionId
    const child = route.chromeSessionId === undefined ? undefined : registry.childTargets.get(route.chromeSessionId)
    return () => {
      const currentRoot = registry.routingRootTarget(route.tabId)
      if (!root || generation !== this.options.generation() || currentRoot?.sessionId !== root.sessionId || currentRoot.targetInfo.targetId !== root.targetInfo.targetId || currentRoot.opencodeBrowserSessionId !== owner) return false
      if (route.chromeSessionId === undefined) return true
      const currentChild = registry.childTargets.get(route.chromeSessionId)
      return child !== undefined && currentChild?.tabId === route.tabId && currentChild.targetInfo.targetId === child.targetInfo.targetId && currentChild.parentSessionId === child.parentSessionId
    }
  }

  private trace(route: CdpRoutedSession, message: string): void {
    this.options.trace?.(`${message} tab=${route.tabId} rootSession=${boundedToken(route.rootSessionId)} chromeSession=${boundedToken(route.chromeSessionId)}`)
  }
}
