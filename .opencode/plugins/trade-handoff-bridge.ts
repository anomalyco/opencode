import type { Hooks, Plugin } from "@opencode-ai/plugin"

type ChildProcessLike = { kill(signal?: number | string): void; exited: Promise<number>; exitCode: number | null }
type PendingSession = {
  pendingSince: number
  providerID?: string
  modelID?: string
  eventPosted: boolean
  retryCount: number
  lastSyncAttemptAt?: number
}

const SYNC_RETRY_BACKOFF_MS = 5000

export default (async ({ directory }) => createTradeHandoffBridgeHooks(directory)) satisfies Plugin

export function createTradeHandoffBridgeHooks(directory: string, options?: { startService?: (directory: string) => ChildProcessLike }): Hooks {
  let child: ChildProcessLike | undefined
  let starting: Promise<boolean> | undefined
  const pendingSessions = new Map<string, PendingSession>()
  const sessionModelState = new Map<string, { lastInjectedModelID?: string }>()

  const ensureService = () => {
    if (starting) return starting
    starting = Promise.resolve()
      .then(async () => {
        if (await isHealthy()) return true
        if (!isAutostartEnabled()) return false
        if (!child || child.exitCode !== null) child = (options?.startService ?? startService)(directory)
        await Bun.sleep(1200)
        return isHealthy()
      })
      .catch(() => false)
      .finally(() => {
        starting = undefined
      })
    return starting
  }

  return {
    dispose: async () => {
      child?.kill()
      if (child) await child.exited
      pendingSessions.clear()
      sessionModelState.clear()
    },
    config: async () => {
      await ensureService()
    },
    event: async (input) => {
      const event = readModelSwitchedEvent(input.event)
      if (!event?.sessionID) return
      const pendingSince = Date.now()
      pendingSessions.set(event.sessionID, {
        pendingSince,
        providerID: event.model?.providerID,
        modelID: event.model?.id,
        eventPosted: false,
        retryCount: 0,
      })
      if (!(await ensureService())) return
      const state = pendingSessions.get(event.sessionID)
      if (!state) return
      const posted = await postModelSwitched(event.sessionID, state)
      if (posted) state.eventPosted = true
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      await injectFreshHandoff({ sessionID: input.sessionID, modelID: input.model.id, append: (line) => output.system.push(line) })
    },
    "experimental.session.compacting": async (input, output) => {
      await injectFreshHandoff({ sessionID: input.sessionID, append: (line) => output.context.push(line) })
    },
  }

  async function injectFreshHandoff(input: { sessionID: string; modelID?: string; append: (line: string) => void }) {
    if (!(await ensureService())) {
      input.append("trade memory handoff unavailable")
      return
    }
    const pending = ensurePendingState(input.sessionID, input.modelID)
    if (pending && !pending.eventPosted) pending.eventPosted = await postModelSwitched(input.sessionID, pending)
    const synced = pending ? await syncPending(input.sessionID, pending) : true
    if (pending && !synced) input.append("trade memory handoff may be stale")
    const result = await postJson("/handoff/context", {
      session_id: input.sessionID,
      model_id: input.modelID,
    }).catch(() => undefined)
    const block = typeof result?.block === "string" ? result.block.trim() : ""
    if (!block) {
      input.append("trade memory handoff unavailable")
      return
    }
    input.append(block)
    if (input.modelID) sessionModelState.set(input.sessionID, { lastInjectedModelID: input.modelID })
    const resultPendingSince = readPendingSince(result)
    const resultPendingModelID = readPendingModelID(result)
    const contentHash = readContentHash(result)
    const expectedPendingSince = pending?.pendingSince ?? resultPendingSince
    const expectedModelID = pending?.modelID ?? resultPendingModelID
    if (isFreshEnough(result, expectedPendingSince, synced) && pendingReadyForAck(pending, expectedPendingSince, expectedModelID, contentHash, synced)) {
      const acked = await postJson("/handoff/ack", {
        session_id: input.sessionID,
        model_id: input.modelID ?? expectedModelID,
        acked_at: Date.now(),
        expected_pending_since: expectedPendingSince,
        expected_model_id: expectedModelID,
        content_hash: contentHash,
      }).then((response) => isAckCleared(response)).catch(() => false)
      const current = pendingSessions.get(input.sessionID)
      if (acked && pendingMatches(current, expectedPendingSince, expectedModelID)) pendingSessions.delete(input.sessionID)
    }
  }

  function ensurePendingState(sessionID: string, modelID?: string) {
    const pending = pendingSessions.get(sessionID)
    if (pending) return pending
    const inferred = inferPendingFromModel(sessionID, modelID)
    if (!inferred) return undefined
    pendingSessions.set(sessionID, inferred)
    return inferred
  }

  function inferPendingFromModel(sessionID: string, modelID?: string) {
    const previous = sessionModelState.get(sessionID)
    if (!previous?.lastInjectedModelID || !modelID || previous.lastInjectedModelID === modelID) return undefined
    return {
      pendingSince: Date.now(),
      modelID,
      eventPosted: false,
      retryCount: 0,
    } satisfies PendingSession
  }

  async function syncPending(sessionID: string, pending: PendingSession) {
    const now = Date.now()
    if (pending.lastSyncAttemptAt && now - pending.lastSyncAttemptAt < SYNC_RETRY_BACKOFF_MS) return false
    pending.lastSyncAttemptAt = now
    const synced = await postJson("/sync", {}).then(() => true).catch(() => false)
    if (!synced) {
      pending.retryCount += 1
      return false
    }
    sessionModelState.set(sessionID, { lastInjectedModelID: pending.modelID })
    return true
  }

  async function postModelSwitched(sessionID: string, pending: PendingSession) {
    return postJson("/handoff/model-switched", {
      session_id: sessionID,
      provider_id: pending.providerID,
      model_id: pending.modelID,
      pending_since: pending.pendingSince,
    }).then(() => true).catch(() => false)
  }

  async function isHealthy() {
    try {
      const response = await fetch(new URL("/health", serviceUrl()), {
        headers: serviceHeaders(),
        signal: AbortSignal.timeout(timeoutMs()),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async function postJson(pathname: string, body: Record<string, unknown>) {
    const response = await fetch(new URL(pathname, serviceUrl()), {
      method: "POST",
      headers: serviceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    })
    if (!response.ok) throw new Error(`service request failed: ${response.status}`)
    return response.json()
  }
}

function readPendingSince(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const pending = Reflect.get(result, "pendingSince")
  return typeof pending === "number" ? pending : undefined
}

function readPendingModelID(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const pending = Reflect.get(result, "pendingModelID")
  return typeof pending === "string" ? pending : undefined
}

function readContentHash(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const value = Reflect.get(result, "contentHash")
  return typeof value === "string" ? value : undefined
}

function isAckCleared(result: unknown) {
  if (!result || typeof result !== "object") return false
  return Reflect.get(result, "cleared") === true
}

function pendingReadyForAck(
  pending: PendingSession | undefined,
  expectedPendingSince: number | undefined,
  expectedModelID: string | undefined,
  contentHash: string | undefined,
  synced: boolean,
) {
  if (!expectedPendingSince || !contentHash) return false
  if (!pending) return true
  return pending.eventPosted && synced
}

function pendingMatches(pending: PendingSession | undefined, pendingSince: number | undefined, modelID: string | undefined) {
  if (!pending) return true
  return pending.pendingSince === pendingSince && pending.modelID === modelID
}

function isFreshEnough(result: unknown, pendingSince: number | undefined, synced: boolean) {
  if ((!synced && pendingSince === undefined) || !result || typeof result !== "object") return false
  const pending = Reflect.get(result, "pendingSince")
  const fresh = Reflect.get(result, "fresh")
  if (typeof fresh === "boolean") {
    if (pendingSince === undefined) return fresh
    return fresh && (typeof pending !== "number" || pending <= pendingSince)
  }
  return false
}

function startService(directory: string) {
  const command = parseServiceCommand(process.env.OPENCODE_TRADE_MEMORY_SERVICE_COMMAND)
  const proc = Bun.spawn(command ?? ["bun", ".opencode/mcp/trade-memory-server.ts", "--http"], {
    cwd: directory,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  })
  return proc
}

export function parseServiceCommand(input: string | undefined) {
  const value = input?.trim()
  if (!value) return undefined
  return value.split(/\s+/).filter(Boolean)
}

export function readModelSwitchedEvent(input: object): { sessionID?: string; model?: { providerID?: string; id?: string } } | undefined {
  const type = Reflect.get(input, "type")
  if (type !== "session.next.model.switched") return undefined
  const properties = Reflect.get(input, "properties")
  if (!properties || typeof properties !== "object") return undefined
  const model = Reflect.get(properties, "model")
  return {
    sessionID: typeof Reflect.get(properties, "sessionID") === "string" ? String(Reflect.get(properties, "sessionID")) : undefined,
    model:
      model && typeof model === "object"
        ? {
            providerID: typeof Reflect.get(model, "providerID") === "string" ? String(Reflect.get(model, "providerID")) : undefined,
            id: typeof Reflect.get(model, "id") === "string" ? String(Reflect.get(model, "id")) : undefined,
          }
        : undefined,
  }
}

function serviceHeaders(headers?: Record<string, string>) {
  const token = process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN?.trim()
  if (!token) return headers ?? {}
  return {
    ...headers,
    authorization: `Bearer ${token}`,
  }
}

function serviceUrl() {
  return process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL ?? "http://127.0.0.1:19787"
}

function timeoutMs() {
  const parsed = Number(process.env.OPENCODE_TRADE_MEMORY_SERVICE_TIMEOUT_MS ?? 3000)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3000
}

function isAutostartEnabled() {
  return process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART !== "false"
}
