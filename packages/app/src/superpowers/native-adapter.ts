import type { FormInfo, OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { projectAgentTree, type AgentTree } from "./agent-tree"
import { scopeKey, type ExecutionScope } from "./identity"
import type { NativeRecord } from "./native-types"

export type NativeScope = ExecutionScope & { serverKey: ServerConnection.Key }

export type NativeTarget = {
  scope: NativeScope
  selectedSessionID: string
}

export type NativeSessionInfo = {
  id: string
  parentID?: string
  title?: string
  directory: string
  model?: { id: string; providerID: string }
}

export type NativeDetail = {
  info: NativeSessionInfo
  needsInput: boolean
}

export type NativeChildPage = {
  data: NativeSessionInfo[]
  next?: string
}

export type NativeBoundary = {
  detail(input: { sessionID: string; signal?: AbortSignal }): Promise<NativeDetail>
  children(input: { sessionID: string; cursor?: string; signal?: AbortSignal }): Promise<NativeChildPage>
  active(input?: { signal?: AbortSignal }): Promise<Record<string, { type: "running" }>>
}

export type NativeSnapshot = AgentTree & {
  scope: NativeScope
}

export type NativeExecutionAdapter = {
  snapshot(): NativeSnapshot
  hydrate(): Promise<NativeSnapshot>
  openSession(sessionID: string): string
  dispose(): void
}

export function nativeState(record: NativeRecord) {
  if (record.needsInput) return "needs_input"
  if (record.error) return "error"
  if (record.status === "running") return "running"
  if (record.status === "idle") return "idle"
  return "unknown"
}

export function nativeRecord(
  info: NativeSessionInfo,
  status: NativeRecord["status"],
  needsInput: boolean,
): NativeRecord {
  return {
    id: info.id,
    parentID: info.parentID,
    title: info.title ?? "",
    directory: info.directory,
    status,
    needsInput,
    model: info.model ? { id: info.model.id, providerID: info.model.providerID } : undefined,
  }
}

export function createNativeBoundary(input: { api: Pick<OpenCodeClient, "permission" | "session"> }): NativeBoundary {
  const session = input.api.session
  return {
    async detail({ sessionID, signal }) {
      const [info, permissions, forms] = await Promise.all([
        session.get({ sessionID }, { signal }),
        input.api.permission.list({ sessionID }, { signal }),
        session.form.list({ sessionID }, { signal }),
      ])
      return { info: nativeInfo(info), needsInput: permissions.length > 0 || forms.some(isAttentionForm) }
    },
    async children({ sessionID, cursor, signal }) {
      const response = await session.list({ parentID: sessionID, order: "desc", cursor }, { signal })
      return { data: response.data.map(nativeInfo), next: response.cursor.next ?? undefined }
    },
    active: ({ signal } = {}) => session.active({ signal }),
  }
}

function nativeInfo(session: SessionInfo): NativeSessionInfo {
  return {
    id: session.id,
    parentID: session.parentID,
    title: session.title,
    directory: session.location.directory,
    model: session.model ? { id: session.model.id, providerID: session.model.providerID } : undefined,
  }
}

function isAttentionForm(form: FormInfo) {
  return form.metadata?.kind === "question" || form.metadata?.kind === "websearch.provider"
}

export function createNativeExecutionAdapter(input: {
  target: () => NativeTarget
  boundary: NativeBoundary
  signal?: AbortSignal
}): NativeExecutionAdapter {
  const records = new Map<string, NativeRecord>()
  const requests = new Map<string, Promise<NativeRecord | undefined>>()
  const semaphore = createSemaphore(4)
  const controller = new AbortController()
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal
  let disposed = false
  let activeKey: string | undefined
  let generation = 0

  const stale = (current: number) => disposed || signal.aborted || generation !== current
  const runNative = <Value>(task: () => Promise<Value>) => semaphore.run(task)

  function snapshot(): NativeSnapshot {
    const current = input.target()
    const tree = projectAgentTree(current.selectedSessionID, [...records.values()])
    const aligned = tree.rootSessionID === current.scope.rootSessionID
    return {
      scope: current.scope,
      rootSessionID: aligned ? tree.rootSessionID : undefined,
      nodes: tree.nodes,
      complete: aligned && tree.complete,
      missingParentID: tree.missingParentID,
    }
  }

  function detail(sessionID: string): Promise<NativeRecord | undefined> {
    const pending = requests.get(sessionID)
    if (pending) return pending
    const request = loadDetail(sessionID).finally(() => {
      if (requests.get(sessionID) === request) requests.delete(sessionID)
    })
    requests.set(sessionID, request)
    return request
  }

  async function loadDetail(sessionID: string): Promise<NativeRecord | undefined> {
    const current = generation
    try {
      const loaded = await runNative(() => input.boundary.detail({ sessionID, signal }))
      if (stale(current)) return records.get(sessionID)
      const record = nativeRecord(loaded.info, "unknown", loaded.needsInput)
      records.set(sessionID, record)
      return record
    } catch (error) {
      if (stale(current)) return records.get(sessionID)
      const provisional = records.get(sessionID)
      const placeholder = nativeRecord(
        {
          id: sessionID,
          parentID: provisional?.parentID,
          title: provisional?.title,
          directory: provisional?.directory ?? input.target().scope.ownerDirectory,
        },
        "unknown",
        false,
      )
      placeholder.error = error instanceof Error ? error.message : String(error)
      records.set(sessionID, placeholder)
      return placeholder
    }
  }

  async function resolveRoot(selectedSessionID: string, current: number) {
    const seen = new Set([selectedSessionID])
    const chain: string[] = []
    let cursor = selectedSessionID
    while (!stale(current)) {
      const record = await detail(cursor)
      if (!record || record.error) return { chain }
      chain.push(cursor)
      if (!record.parentID) return { rootID: cursor, chain }
      if (seen.has(record.parentID)) return { chain }
      seen.add(record.parentID)
      cursor = record.parentID
    }
    return { chain }
  }

  async function listChildIDs(parentID: string, current: number) {
    const ids: string[] = []
    let cursor: string | undefined
    do {
      if (stale(current)) return ids
      const page = await runNative(() => input.boundary.children({ sessionID: parentID, cursor, signal }))
      if (stale(current)) return ids
      for (const info of page.data) {
        if (!records.has(info.id)) records.set(info.id, nativeRecord(info, "unknown", false))
        ids.push(info.id)
      }
      cursor = page.next
    } while (cursor)
    return ids
  }

  async function hydrateDescendants(rootID: string, current: number, detailed: Set<string>) {
    const visited = new Set([rootID])
    let frontier = [rootID]
    while (frontier.length && !stale(current)) {
      const discovered = (await Promise.all(frontier.map((parentID) => listChildIDs(parentID, current)))).flat()
      if (stale(current)) return
      const fresh = discovered.filter((id) => !visited.has(id))
      for (const id of fresh) visited.add(id)
      await Promise.all(fresh.filter((id) => !detailed.has(id)).map((id) => detail(id)))
      frontier = fresh.filter((id) => {
        const record = records.get(id)
        return !!record && record.error === undefined
      })
    }
  }

  function applyStatuses(active: Record<string, { type: "running" }>) {
    for (const [id, record] of records) {
      if (record.error !== undefined) continue
      records.set(id, { ...record, status: active[id] ? "running" : "idle" })
    }
  }

  async function hydrate(): Promise<NativeSnapshot> {
    const currentTarget = input.target()
    const key = scopeKey(currentTarget.scope)
    if (key !== activeKey) {
      activeKey = key
      generation += 1
      records.clear()
      requests.clear()
    }
    const current = generation

    const resolution = await resolveRoot(currentTarget.selectedSessionID, current)
    if (stale(current)) return snapshot()
    if (resolution.rootID !== currentTarget.scope.rootSessionID) return snapshot()

    await hydrateDescendants(currentTarget.scope.rootSessionID, current, new Set(resolution.chain))
    if (stale(current)) return snapshot()

    const active = await runNative(() => input.boundary.active({ signal }))
    if (stale(current)) return snapshot()

    applyStatuses(active)
    return snapshot()
  }

  function openSession(sessionID: string) {
    return sessionHref(input.target().scope.serverKey, sessionID)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation += 1
    controller.abort()
    requests.clear()
  }

  return { snapshot, hydrate, openSession, dispose }
}

function createSemaphore(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = async () => {
    if (active < limit) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = () => {
    const next = waiting.shift()
    if (!next) {
      active -= 1
      return
    }
    next()
  }
  return {
    async run<Value>(task: () => Promise<Value>): Promise<Value> {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
