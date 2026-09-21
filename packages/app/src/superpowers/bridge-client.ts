import type { OpenCodeEvent } from "@opencode/client/promise"
import { ClientError, type RpcCallOptions, type RpcClient } from "@opencode/client/promise"
import { ChangedSchema, ExecutionRpc, type RunSnapshot, type RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { runKey, scopeKey, type ExecutionScope } from "./identity"
import {
  createExecutionModel,
  type EvidenceNavigator,
  type EvidenceResolver,
  type ExecutionAgent,
  type ExecutionAttention,
  type ExecutionMode,
  type ExecutionModel,
  type ExecutionReason,
} from "./model"

export const EXECUTION_RECONCILE_INTERVAL = 15_000
export const EXECUTION_RUN_CACHE_LIMIT = 20

export type ExecutionClock = {
  now(): number
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export type ExecutionEventSource = {
  listen(handler: (event: OpenCodeEvent) => void): () => void
}

export type ExecutionBridgeInput = {
  scope: Accessor<ExecutionScope | undefined>
  api: () => RpcClient<typeof ExecutionRpc, RpcCallOptions>
  events: ExecutionEventSource
  connection: Accessor<boolean>
  visible: Accessor<boolean>
  clock?: ExecutionClock
}

export type ExecutionBridge = {
  attach(runID: string): void
  attachActive(): void
  getSnapshot(): RunSnapshot | undefined
  getMode(): ExecutionMode
  getReason(): ExecutionReason | undefined
  reconcile(): void
  dispose(): void
}

export type SessionExecutionInput = {
  scope: Accessor<ExecutionScope | undefined>
  api: () => RpcClient<typeof ExecutionRpc, RpcCallOptions>
  events: ExecutionEventSource
  connection: Accessor<boolean>
  visible: Accessor<boolean>
  agents?: Accessor<ExecutionAgent[]>
  attention?: Accessor<ExecutionAttention>
  openSession?: (sessionID: string) => void
  resolveEvidence?: EvidenceResolver
  navigateEvidence?: EvidenceNavigator
  reviewRequest?: () => void
  clock?: ExecutionClock
}

export type SessionExecution = {
  bridge: ExecutionBridge
  model: ExecutionModel
  dispose(): void
}

type Attachment = {
  scope: ExecutionScope
  runID: string
  generation: number
}

export function shouldApplySnapshot(input: {
  requestGeneration: number
  activeGeneration: number
  incomingRevision: number
  currentRevision: number
}) {
  return input.requestGeneration === input.activeGeneration && input.incomingRevision >= input.currentRevision
}

export function preferredRun(items: RunSummary[]) {
  return items.reduce<RunSummary | undefined>((best, item) => {
    if (!best) return item
    if ((item.status === "active") !== (best.status === "active")) return item.status === "active" ? item : best
    return item.updatedAt > best.updatedAt ? item : best
  }, undefined)
}

export function createExecutionBridge(input: ExecutionBridgeInput): ExecutionBridge {
  const clock = input.clock ?? systemClock
  const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>()
  const [mode, setMode] = createSignal<ExecutionMode>("observer")
  const [reason, setReason] = createSignal<ExecutionReason | undefined>()
  const [attachmentVersion, setAttachmentVersion] = createSignal(0)

  let disposed = false
  let attachment: Attachment | undefined
  let generation = 0
  let revision = 0
  let highestRevision = 0
  let inFlight = false
  let followUp = false
  let capabilitiesLoaded = false
  let currentMode: ExecutionMode = "observer"
  let online = input.connection()
  let timer: unknown
  let unsubscribe: (() => void) | undefined
  const runCache = new Map<string, RunSnapshot>()
  let cachedScopeKey: string | undefined

  function setModeValue(next: ExecutionMode) {
    if (currentMode === next) return
    currentMode = next
    setMode(next)
  }

  function setReasonValue(next: ExecutionReason | undefined) {
    if (reason() === next) return
    setReason(next)
  }

  function ensureListener() {
    if (unsubscribe) return
    unsubscribe = input.events.listen(onChanged)
  }

  function onChanged(event: OpenCodeEvent) {
    if (disposed) return
    if (event.type !== "rpc.superpowers.execution.v1.changed") return
    const scope = attachment?.scope ?? input.scope()
    if (!scope) return
    if (eventLocationDirectory(event) !== scope.ownerDirectory) return
    const parsed = ChangedSchema.safeParse(event.data)
    if (!parsed.success) return
    if (parsed.data.rootSessionID !== scope.rootSessionID) return
    if (!attachment) {
      if (currentMode !== "incompatible") void attachActive()
      return
    }
    if (parsed.data.runID !== attachment.runID) return
    if (parsed.data.revision <= highestRevision) return
    highestRevision = parsed.data.revision
    reconcile()
  }

  function startTimer() {
    if (timer !== undefined) return
    timer = clock.setInterval(() => (attachment ? reconcile() : attachActive()), EXECUTION_RECONCILE_INTERVAL)
  }

  function stopTimer() {
    if (timer === undefined) return
    clock.clearInterval(timer)
    timer = undefined
  }

  function reconcile() {
    if (disposed) return
    if (!input.connection()) {
      online = false
      stopTimer()
      setReasonValue("offline")
      if (snapshot()) setModeValue("stale")
      return
    }
    if (!online) {
      online = true
      capabilitiesLoaded = false
      setReasonValue(undefined)
      if (currentMode === "incompatible" || currentMode === "unavailable") setModeValue("observer")
    }
    if (currentMode === "incompatible") return
    if (input.visible()) startTimer()
    else stopTimer()
    if (!attachment) return
    if (inFlight) {
      followUp = true
      return
    }
    void sync()
  }

  async function sync() {
    const current = attachment
    if (!current) return
    const requestGeneration = current.generation
    inFlight = true
    followUp = false
    try {
      if (!capabilitiesLoaded) {
        const capabilities = await input.api().capabilities({}, locationOptions(current.scope))
        if (ignored(requestGeneration)) return
        capabilitiesLoaded = true
        const schemaVersion: number = capabilities.schemaVersion
        if (schemaVersion !== 1) {
          setModeValue("incompatible")
          setReasonValue("incompatible_schema")
          return
        }
      }
      const loaded = await input.api().getRun(
        { rootSessionID: current.scope.rootSessionID, runID: current.runID },
        locationOptions(current.scope),
      )
      if (ignored(requestGeneration)) return
      apply(loaded, requestGeneration)
    } catch (error) {
      if (ignored(requestGeneration)) return
      handleFailure(error)
    } finally {
      const again = followUp
      followUp = false
      inFlight = false
      if (again) reconcile()
    }
  }

  async function attachActive() {
    const scope = input.scope()
    if (disposed || !scope) return
    resetForScope(scope)
    const requestGeneration = generation
    ensureListener()
    setAttachmentVersion((value) => value + 1)
    if (!input.connection()) {
      online = false
      stopTimer()
      setReasonValue("offline")
      return
    }
    online = true
    try {
      const capabilities = await input.api().capabilities({}, locationOptions(scope))
      if (ignoredDiscovery(requestGeneration)) return
      capabilitiesLoaded = true
      const schemaVersion: number = capabilities.schemaVersion
      if (schemaVersion !== 1) {
        setModeValue("incompatible")
        setReasonValue("incompatible_schema")
        return
      }
      const page = await input.api().getSummaries({ rootSessionIDs: [scope.rootSessionID] }, locationOptions(scope))
      if (ignoredDiscovery(requestGeneration)) return
      const preferred = preferredRun(page.items)
      if (!preferred) {
        setModeValue("observer")
        setReasonValue("no_run")
        reconcile()
        return
      }
      attachment = { scope, runID: preferred.runID, generation: requestGeneration }
      setReasonValue(undefined)
      setAttachmentVersion((value) => value + 1)
      reconcile()
    } catch (error) {
      if (ignoredDiscovery(requestGeneration)) return
      handleFailure(error)
      if (currentMode !== "incompatible") reconcile()
    }
  }

  function resetForScope(scope: ExecutionScope) {
    const nextScopeKey = scopeKey(scope)
    if (cachedScopeKey !== nextScopeKey) {
      cachedScopeKey = nextScopeKey
      runCache.clear()
    }
    generation += 1
    attachment = undefined
    capabilitiesLoaded = false
    followUp = false
    revision = 0
    highestRevision = 0
    setSnapshot(undefined)
    setModeValue("observer")
    setReasonValue(undefined)
  }

  function apply(loaded: RunSnapshot, requestGeneration: number) {
    const active = attachment?.generation ?? -1
    const applies = shouldApplySnapshot({
      requestGeneration,
      activeGeneration: active,
      incomingRevision: loaded.revision,
      currentRevision: revision,
    })
    if (!applies) return
    revision = loaded.revision
    highestRevision = Math.max(highestRevision, loaded.revision)
    cacheRun(loaded)
    setSnapshot(loaded)
    setModeValue("ready")
    setReasonValue(undefined)
  }

  function cacheRun(loaded: RunSnapshot) {
    if (!attachment) return
    const key = runKey(attachment.scope, attachment.runID)
    runCache.delete(key)
    runCache.set(key, loaded)
    if (runCache.size > EXECUTION_RUN_CACHE_LIMIT) {
      const oldest = runCache.keys().next().value
      if (oldest !== undefined) runCache.delete(oldest)
    }
  }

  function handleFailure(error: unknown) {
    const failure = failureReason(error)
    if (failure === "incompatible_schema") {
      capabilitiesLoaded = true
      setModeValue("incompatible")
      setReasonValue(failure)
      return
    }
    setReasonValue(failure)
    if (snapshot()) {
      setModeValue("stale")
      return
    }
    setModeValue(failure === "plugin_absent" || failure === "no_run" ? "observer" : "unavailable")
  }

  function ignored(requestGeneration: number) {
    return disposed || attachment?.generation !== requestGeneration
  }

  function ignoredDiscovery(requestGeneration: number) {
    return disposed || generation !== requestGeneration
  }

  function attach(runID: string) {
    if (disposed) return
    const scope = input.scope()
    if (!scope) return
    const previous = attachment
    const sameIdentity = previous !== undefined && runKey(previous.scope, previous.runID) === runKey(scope, runID)
    const nextScopeKey = scopeKey(scope)
    if (cachedScopeKey !== nextScopeKey) {
      cachedScopeKey = nextScopeKey
      runCache.clear()
    }
    generation += 1
    attachment = { scope, runID, generation }
    capabilitiesLoaded = false
    followUp = false
    if (!sameIdentity) {
      const cached = runCache.get(runKey(scope, runID))
      revision = cached?.revision ?? 0
      highestRevision = cached?.revision ?? 0
      setSnapshot(cached)
      setModeValue(cached ? "ready" : "observer")
      setReasonValue(cached ? undefined : "no_run")
    }
    ensureListener()
    setAttachmentVersion((value) => value + 1)
    reconcile()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation += 1
    attachment = undefined
    runCache.clear()
    stopTimer()
    unsubscribe?.()
    unsubscribe = undefined
    setAttachmentVersion((value) => value + 1)
  }

  createEffect(() => {
    attachmentVersion()
    input.connection()
    input.visible()
    reconcile()
  })

  return {
    attach,
    attachActive,
    getSnapshot: snapshot,
    getMode: mode,
    getReason: reason,
    reconcile,
    dispose,
  }
}

export function createSessionExecution(input: SessionExecutionInput): SessionExecution {
  const bridge = createExecutionBridge({
    scope: input.scope,
    api: input.api,
    events: input.events,
    connection: input.connection,
    visible: input.visible,
    clock: input.clock,
  })
  const model = createExecutionModel({
    scope: input.scope,
    mode: () => bridge.getMode(),
    reason: () => bridge.getReason(),
    snapshot: () => bridge.getSnapshot(),
    agents: input.agents,
    attention: input.attention,
    openSession: input.openSession,
    resolveEvidence: input.resolveEvidence,
    navigateEvidence: input.navigateEvidence,
    reviewRequest: input.reviewRequest,
    reconcile: () => bridge.reconcile(),
  })
  let attachedScopeKey: string | undefined
  let disposed = false
  const attach = () => {
    const scope = input.scope()
    if (!scope) return
    const key = scopeKey(scope)
    if (key === attachedScopeKey) return
    attachedScopeKey = key
    bridge.attachActive()
  }
  attach()
  createEffect(() => {
    input.scope()
    attach()
  })
  const dispose = () => {
    if (disposed) return
    disposed = true
    attachedScopeKey = undefined
    bridge.dispose()
  }
  onCleanup(dispose)
  return { bridge, model, dispose }
}

function locationOptions(scope: ExecutionScope): RpcCallOptions {
  return { location: { directory: scope.ownerDirectory } }
}

function eventLocationDirectory(event: OpenCodeEvent) {
  const location = (event as { location?: { directory?: string } }).location
  return location?.directory
}

function failureReason(error: unknown): ExecutionReason {
  if (error instanceof ClientError) {
    const status = clientErrorStatus(error)
    if (error.reason === "UnexpectedStatus" && (status === 401 || status === 403)) return "auth"
    return "transport"
  }
  if (!isRpcFailure(error)) return "transport"
  if (error.type === "rpc.unavailable" || error.type === "rpc.method_not_found") return "plugin_absent"
  if (error.type === "rpc.invalid_output" || error.type === "rpc.internal" || error.type === "rpc.invalid_input") {
    return "incompatible_schema"
  }
  if (error.type !== "execution") return "transport"
  const code = rpcFailureCode(error)
  if (code === "incompatible_schema") return "incompatible_schema"
  if (code === "not_found") return "no_run"
  if (code === "forbidden") return "auth"
  return "transport"
}

function clientErrorStatus(error: ClientError) {
  const cause = error.cause
  if (typeof cause !== "object" || cause === null) return
  if (!("status" in cause)) return
  const status = cause.status
  return typeof status === "number" ? status : undefined
}

type RpcFailure = { type: string; message: string; data?: unknown }

function isRpcFailure(error: unknown): error is RpcFailure {
  if (typeof error !== "object" || error === null) return false
  if (!("type" in error) || typeof error.type !== "string") return false
  return "message" in error && typeof error.message === "string"
}

function rpcFailureCode(error: RpcFailure) {
  const data = error.data
  if (typeof data !== "object" || data === null) return
  if (!("code" in data) || typeof data.code !== "string") return
  return data.code
}

const systemClock: ExecutionClock = {
  now: () => Date.now(),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}
