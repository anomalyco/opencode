import type { OpenCodeEvent } from "@opencode/client/promise"
import { ClientError, type RpcCallOptions, type RpcClient } from "@opencode/client/promise"
import { ChangedSchema, ExecutionRpc, type RunSnapshot } from "@bearmanser/opencode-superpowers-execution/contract"
import { createEffect, createSignal, type Accessor } from "solid-js"
import { runKey, scopeKey, type ExecutionScope } from "./identity"
import type { ExecutionMode } from "./model"

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
  api: RpcClient<typeof ExecutionRpc, RpcCallOptions>
  events: ExecutionEventSource
  connection: Accessor<boolean>
  visible: Accessor<boolean>
  clock?: ExecutionClock
}

export type ExecutionBridge = {
  attach(runID: string): void
  getSnapshot(): RunSnapshot | undefined
  getMode(): ExecutionMode
  reconcile(): void
  dispose(): void
}

type Attachment = {
  scope: ExecutionScope
  runID: string
  generation: number
}

type FailureKind = "observer" | "unavailable" | "incompatible" | "transient"

export function shouldApplySnapshot(input: {
  requestGeneration: number
  activeGeneration: number
  incomingRevision: number
  currentRevision: number
}) {
  return input.requestGeneration === input.activeGeneration && input.incomingRevision >= input.currentRevision
}

export function createExecutionBridge(input: ExecutionBridgeInput): ExecutionBridge {
  const clock = input.clock ?? systemClock
  const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>()
  const [mode, setMode] = createSignal<ExecutionMode>("observer")
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

  function ensureListener() {
    if (unsubscribe) return
    unsubscribe = input.events.listen(onChanged)
  }

  function onChanged(event: OpenCodeEvent) {
    if (disposed || !attachment) return
    if (event.type !== "rpc.superpowers.execution.v1.changed") return
    const directory = eventLocationDirectory(event)
    if (directory !== undefined && directory !== attachment.scope.ownerDirectory) return
    const parsed = ChangedSchema.safeParse(event.data)
    if (!parsed.success) return
    if (parsed.data.rootSessionID !== attachment.scope.rootSessionID) return
    if (parsed.data.runID !== attachment.runID) return
    if (parsed.data.revision <= highestRevision) return
    highestRevision = parsed.data.revision
    reconcile()
  }

  function startTimer() {
    if (timer !== undefined) return
    timer = clock.setInterval(() => reconcile(), EXECUTION_RECONCILE_INTERVAL)
  }

  function stopTimer() {
    if (timer === undefined) return
    clock.clearInterval(timer)
    timer = undefined
  }

  function reconcile() {
    if (disposed || !attachment) return
    if (!input.connection()) {
      online = false
      stopTimer()
      if (snapshot()) setModeValue("stale")
      return
    }
    if (!online) {
      online = true
      capabilitiesLoaded = false
      if (currentMode === "incompatible" || currentMode === "unavailable") setModeValue("observer")
    }
    if (currentMode === "incompatible") return
    if (!input.visible()) {
      stopTimer()
      return
    }
    startTimer()
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
        const capabilities = await input.api.capabilities({}, callOptions(current))
        if (ignored(requestGeneration)) return
        capabilitiesLoaded = true
        const schemaVersion: number = capabilities.schemaVersion
        if (schemaVersion !== 1) {
          setModeValue("incompatible")
          return
        }
      }
      const loaded = await input.api.getRun(
        { rootSessionID: current.scope.rootSessionID, runID: current.runID },
        callOptions(current),
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
    const kind = failureKind(error)
    if (kind === "incompatible") {
      capabilitiesLoaded = true
      setModeValue("incompatible")
      return
    }
    if (snapshot()) {
      setModeValue("stale")
      return
    }
    setModeValue(kind === "observer" ? "observer" : "unavailable")
  }

  function ignored(requestGeneration: number) {
    return disposed || attachment?.generation !== requestGeneration
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
    getSnapshot: snapshot,
    getMode: mode,
    reconcile,
    dispose,
  }
}

function callOptions(attachment: Attachment): RpcCallOptions {
  return { location: { directory: attachment.scope.ownerDirectory } }
}

function eventLocationDirectory(event: OpenCodeEvent) {
  const location = (event as { location?: { directory?: string } }).location
  return location?.directory
}

function failureKind(error: unknown): FailureKind {
  if (error instanceof ClientError) {
    const status = clientErrorStatus(error)
    if (error.reason === "UnexpectedStatus" && (status === 401 || status === 403)) return "unavailable"
    return "transient"
  }
  if (!isRpcFailure(error)) return "transient"
  if (error.type === "rpc.unavailable" || error.type === "rpc.method_not_found") return "observer"
  if (error.type === "rpc.invalid_output" || error.type === "rpc.internal" || error.type === "rpc.invalid_input") {
    return "incompatible"
  }
  if (error.type !== "execution") return "transient"
  const code = rpcFailureCode(error)
  if (code === "incompatible_schema") return "incompatible"
  if (code === "not_found") return "observer"
  if (code === "forbidden") return "unavailable"
  return "transient"
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
