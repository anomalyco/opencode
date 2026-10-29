// Client data layer: apply server events and cache API reads into a Solid store.
// Prefer straightforward projection. Invalidated reads revalidate serially so an older
// response cannot commit after its replacement. Reconnect invalidates cached reads;
// active UI owners decide what to sync again.

import type {
  AgentInfo,
  CommandInfo,
  ConfigEntry,
  SessionFormCancelInput,
  FormInfo,
  SessionFormReplyInput,
  IntegrationInfo,
  LocationRef,
  LocationGetOutput,
  McpResource,
  McpServer,
  ModelInfo,
  ModelRef,
  PermissionSavedInfo,
  PermissionRequest,
  PermissionReplyInput,
  Project,
  ProviderInfo,
  ReferenceInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionInfo,
  SessionListInput,
  SessionInboxInfo,
  SessionInboxCompaction,
  ShellInfo,
  SkillInfo,
  ToolContent,
  UsageLimitsInfo,
  VcsInfo,
  OpenCodeEvent,
  OpenCodeClient,
  WebSearchProvider,
} from "../promise"
import { Worktree } from "@opencode/schema/worktree"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import {
  ClientError,
  isFormAlreadySettledError,
  isFormNotFoundError,
  isMessageNotFoundError,
  isPermissionNotFoundError,
  isSessionNotFoundError,
  type SessionPromptInput,
} from "../promise"
import { createStore, produce, reconcile } from "solid-js/store"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

export type DataSessionStatus = "idle" | "running"
/**
 * Where a pending user prompt stands relative to the runner: `starting` is promoted at the next idle boundary,
 * `steering` waits for the next step boundary of an execution that already delivered input, `stranded` outlived an
 * execution that ended without delivering it, and `queued` waits for every steer to drain.
 */
export type DataPendingStatus = "starting" | "steering" | "stranded" | "queued"
type OpenCodeEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export type CreateDataInput = {
  readonly api: () => OpenCodeClient
  readonly directory: string
  /** Raw-message window used for an initial transcript read. Older pages retain their normal size. */
  readonly initialMessageLimit?: () => number
  readonly event: {
    readonly on: <Type extends OpenCodeEvent["type"]>(
      type: Type,
      handler: (event: OpenCodeEventMap[Type]) => void,
    ) => () => void
    readonly listen: (handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) => () => void
  }
  readonly connection?: {
    readonly status: () => "connected" | "connecting" | "reconnecting"
  }
  /** Receives failed event-driven reads. Explicit reads still reject to their caller. */
  readonly onError?: (error: unknown) => void
  /**
   * Drops the payload of inline `data:` files in tool results before they enter the store. For clients that never
   * render tool-result files: a session full of screenshots otherwise keeps hundreds of MB of base64 alive.
   */
  readonly omitToolFileData?: boolean
}

const messagePageLimit = 20
// Trailing window for event bursts that each ask for the same refetch.
export const settleMs = 150

// Global MCP elicitations temporarily use "global" instead of a real session ID, so the
// server cannot recover their Location when settling them. Preserve the event Location
// until MCP elicitations carry session ownership.
export type FormWithLocation = FormInfo & { readonly location?: LocationRef }
type ShellWithLocation = ShellInfo & { readonly location: LocationRef }

type LocationData = {
  info?: LocationGetOutput
  vcs?: VcsInfo
  agent?: AgentInfo[]
  command?: CommandInfo[]
  config?: ConfigEntry[]
  integration?: IntegrationInfo[]
  mcpServer?: McpServer[]
  mcpResource?: McpResource[]
  model?: ModelInfo[]
  provider?: ProviderInfo[]
  reference?: ReferenceInfo[]
  websearch?: WebSearchProvider[]
  // The Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to; null when it
  // isn't signed in.
  usageLimits?: UsageLimitsInfo | null
  // Currently running shell commands for this location, keyed by shell id. Entries are removed
  // once the command exits or is deleted, so this only ever holds in-flight shells.
  shell?: Record<string, ShellWithLocation>
  skill?: SkillInfo[]
}

type Store = {
  session: {
    info: Record<string, SessionInfo>
    missing: Record<string, true | undefined>
    // Family index keyed by a family's root (or furthest-known-ancestor when the
    // true root is not yet loaded). The value is a flat deduplicated list of every
    // session ID in that family, including the key itself once its info arrives.
    family: Record<string, string[]>
    active: Record<string, DataSessionStatus>
    message: Record<string, SessionMessageInfo[]>
    messageCursor: Record<string, string | undefined>
    messageLoading: Record<string, boolean>
    pending: Record<string, SessionInboxInfo[]>
    permission: Record<string, PermissionRequest[]>
    // Pending forms keyed by owner: a session ID or the temporary "global" elicitation sentinel.
    form: Record<string, FormWithLocation[]>
  }
  project: {
    info: Record<string, Project>
    permission: Record<string, PermissionSavedInfo[]>
  }
  location: Record<string, LocationData>
}

export function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref: LocationRef) {
  return { directory: ref.directory }
}

function optimisticFiles(files: SessionPromptInput["files"]) {
  const items = files?.flatMap((file) => {
    if (!file.uri.startsWith("data:")) return []
    const comma = file.uri.indexOf(",")
    if (comma < 0) return []
    const header = file.uri.slice(5, comma)
    const parts = header.split(";")
    if (!parts.slice(1).some((part) => part.toLowerCase() === "base64")) return []
    const item: NonNullable<Extract<SessionInboxInfo, { type: "user" }>["payload"]["files"]>[number] = {
      data: file.uri.slice(comma + 1),
      mime: parts[0] || "application/octet-stream",
      source: { type: "inline" },
    }
    if (file.name !== undefined) item.name = file.name
    if (file.description !== undefined) item.description = file.description
    if (file.mention !== undefined) item.mention = { ...file.mention }
    return [item]
  })
  return items?.length ? items : undefined
}

// Keeps an empty `data:<mime>;base64,` URI so the item still says what it was. It is built from `mime` because any
// slice of the original URI is a V8 sliced string that keeps the whole payload alive.
function omitFileData(content: [ToolContent, ...ToolContent[]]): [ToolContent, ...ToolContent[]] {
  const omit = (item: ToolContent): ToolContent =>
    item.type === "file" && item.uri.startsWith("data:") ? { ...item, uri: `data:${item.mime};base64,` } : item
  return [omit(content[0]), ...content.slice(1).map(omit)]
}

function omitMessageFileData(message: SessionMessageInfo): SessionMessageInfo {
  if (message.type !== "assistant") return message
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool" && "content" in part.state && part.state.content
        ? { ...part, state: { ...part.state, content: omitFileData(part.state.content) } }
        : part,
    ),
  }
}

function formRequestOptions(sessionID: string, ref?: LocationRef) {
  if (sessionID !== "global" || !ref) return undefined
  return {
    headers: {
      "x-opencode-directory": encodeURIComponent(ref.directory),
    },
  }
}

function createSync() {
  // `started` is false while a reload waits for the load it replaces. Invalidations that land in
  // that window are already covered, since the reload has not read anything yet.
  type Pending = { promise: Promise<void>; invalidated: boolean; started: boolean }
  const state = new Map<string, true | Pending>()
  // `load` may ask whether its run was invalidated, so a stale response does not mark other keys complete.
  type Load = (stale: () => boolean) => Promise<void>
  const start = (key: string, load: Load, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false, started: !wait }
    state.set(key, entry)
    const run = () => {
      entry.started = true
      return load(() => entry.invalidated)
    }
    entry.promise = (wait ? wait.catch(() => undefined).then(run) : run())
      .then(() => {
        if (state.get(key) === entry && !entry.invalidated) state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    return entry.promise
  }
  return {
    run(key: string, load: Load) {
      const active = state.get(key)
      if (active === true) return Promise.resolve()
      if (!active) return start(key, load)
      if (!active.invalidated) return active.promise
      return start(key, load, active.promise)
    },
    complete(key: string) {
      if (state.has(key)) return
      state.set(key, true)
    },
    has(key: string) {
      return state.has(key)
    },
    invalidate(key?: string) {
      if (key) {
        const active = state.get(key)
        if (active === true) state.delete(key)
        if (active !== undefined && active !== true && active.started) active.invalidated = true
        return
      }
      state.forEach((active, current) => {
        if (active === true) state.delete(current)
        if (active !== true && active.started) active.invalidated = true
      })
    },
  }
}

const CHILD_PAGE = 200
const DELETED_SESSION_LIMIT = 512

// Servers that predate the family route answer it with an empty 404. This also matches any declared status without a
// readable JSON error body, such as a non-JSON 401 or a proxy page; the fallback reads then fail the same way. A missing
// Session is a typed SessionNotFoundError, and transport failures and undeclared statuses keep their own reasons.
function isMissingRoute(error: unknown) {
  return (
    error instanceof ClientError && (error.reason === "UnsupportedContentType" || error.reason === "MalformedResponse")
  )
}

export function createData(config: CreateDataInput) {
  const api = config.api
  let disposed = false
  onCleanup(() => (disposed = true))

  function refresh(load: () => Promise<unknown>) {
    if (disposed || (config.connection && config.connection.status() !== "connected")) return
    void load().catch((error) => {
      if (disposed || (config.connection && config.connection.status() !== "connected")) return
      if (isSessionNotFoundError(error)) {
        markDeleted(error.sessionID)
        return
      }
      if (isMessageNotFoundError(error)) return
      if (config.onError) return config.onError(error)
      console.error("Failed to refresh client data", error)
    })
  }

  // Runs `load` once a burst of same-key events goes quiet, so N events cost one refetch.
  const settling = new Map<string, ReturnType<typeof setTimeout>>()
  onCleanup(() => settling.forEach((timer) => clearTimeout(timer)))
  function settle(key: string, load: () => Promise<unknown>) {
    clearTimeout(settling.get(key))
    settling.set(
      key,
      setTimeout(() => {
        settling.delete(key)
        refresh(load)
      }, settleMs),
    )
  }

  const [store, setStore] = createStore<Store>({
    session: {
      info: {},
      missing: {},
      family: {},
      active: {},
      message: {},
      messageCursor: {},
      messageLoading: {},
      pending: {},
      permission: {},
      form: {},
    },
    project: {
      info: {},
      permission: {},
    },
    location: {},
  })

  const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({ directory: config.directory })
  const sessions = createMemo(() =>
    Object.values(store.session.info).toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const messageIndex = new Map<string, Map<string, number>>()
  const stored = (message: SessionMessageInfo) => (config.omitToolFileData ? omitMessageFileData(message) : message)
  const sync = createSync()
  let activeUpdates: Map<string, DataSessionStatus | undefined> | undefined
  // Learned once per connection, since a reconnect may reach an upgraded server.
  let familyRouteMissing = false
  const pendingUpdates = new Map<string, Map<string, SessionInboxInfo | SessionInbox.Delivery | undefined>>()
  // One journal per Session, family, or pending-request read in flight. Reads and events arrive in either order, and an
  // event recorded during a read is newer than the read, so the read applies its response and then replays the events
  // for the Sessions it returned. Folds must therefore be safe to apply again.
  type Journal = { sessionID: string; apply: () => void; created?: boolean }[]
  const journals = new Set<Journal>()

  function observe(sessionID: string, apply: () => void, created?: boolean) {
    journals.forEach((journal) => journal.push({ sessionID, apply, created }))
    apply()
  }

  async function observeRead<Value>(
    load: () => Promise<Value>,
    commit: (value: Value, journal: Journal) => (sessionID: string) => boolean,
    stale?: () => boolean,
  ) {
    const journal: Journal = []
    journals.add(journal)
    try {
      const value = await load()
      if (stale?.()) return
      batch(() => {
        const covers = commit(value, journal)
        journal.forEach((entry) => {
          if (covers(entry.sessionID)) entry.apply()
        })
      })
    } finally {
      journals.delete(journal)
    }
  }

  // `created` mirrors the projector's `time_updated = event.created` for events that touch the Session.
  function patchSession(sessionID: string, patch: Partial<SessionInfo>, created?: number) {
    observe(sessionID, () => {
      if (!store.session.info[sessionID]) return
      setStore("session", "info", sessionID, patch)
      if (created !== undefined)
        setStore("session", "info", sessionID, "time", "updated", (updated) => Math.max(updated, created))
    })
  }

  function setSessionActive(sessionID: string, status: DataSessionStatus) {
    activeUpdates?.set(sessionID, status)
    setStore("session", "active", sessionID, status)
  }

  function removePending(sessionID: string, inboxID?: string) {
    if (!inboxID) return
    pendingUpdates.get(sessionID)?.set(inboxID, undefined)
    if (store.session.pending[sessionID]?.some((item) => item.id === inboxID))
      setStore(
        "session",
        "pending",
        sessionID,
        (store.session.pending[sessionID] ?? []).filter((item) => item.id !== inboxID),
      )
  }

  function removePermission(sessionID: string, requestID: string) {
    const requests = store.session.permission[sessionID]
    if (!requests?.some((request) => request.id === requestID)) return
    setStore(
      "session",
      "permission",
      sessionID,
      requests.filter((request) => request.id !== requestID),
    )
  }

  function removeForm(sessionID: string, formID: string, ref?: LocationRef) {
    const forms = store.session.form[sessionID]
    if (!forms) return false
    const location = ref && locationKey(ref)
    const next = forms.filter((form) => {
      if (form.id !== formID) return true
      if (sessionID !== "global" || !location) return false
      return !form.location || locationKey(form.location) !== location
    })
    if (next.length === forms.length) return false
    setStore("session", "form", sessionID, next)
    return true
  }

  function settleForm(input: SessionFormCancelInput, ref: LocationRef | undefined, request: Promise<void>) {
    return request
      .catch((error: unknown) => {
        if ((!isFormNotFoundError(error) && !isFormAlreadySettledError(error)) || error.id !== input.formID) throw error
      })
      .then(() => {
        if (!removeForm(input.sessionID, input.formID, ref)) return
        result.session.form.invalidate(input.sessionID, ref)
        void result.session.form.sync(input.sessionID, ref).catch(() => undefined)
      })
  }

  function updatePending(sessionID: string, inboxID: string, delivery: SessionInbox.Delivery) {
    const index = store.session.pending[sessionID]?.findIndex((item) => item.id === inboxID) ?? -1
    const item = store.session.pending[sessionID]?.[index]
    pendingUpdates.get(sessionID)?.set(inboxID, item ? { ...item, delivery } : delivery)
    if (index < 0 || !item || item.delivery === delivery) return
    setStore("session", "pending", sessionID, index, { ...item, delivery })
  }

  // Inbox IDs of optimistic admissions awaiting acknowledgement, so rejection
  // only rolls back unacknowledged rows and a pending re-fetch cannot wipe a
  // row the server does not know about yet. Prompts clear on their durable
  // echo, positive pending read, or rollback; compactions also reconcile the
  // POST's canonical ID.
  const outbox = new Set<string>()

  // Session IDs of optimistic create admissions still awaiting acknowledgement
  // (the session.created echo or the create response itself). A failed create
  // only rolls back a session the server never acknowledged. Unlike
  // `creating`, this clears on the echo rather than request settlement.
  const sessionOutbox = new Set<string>()

  // In-flight optimistic creates by session ID. prompt() gates its POST on
  // this so a prompt sent to a still-creating session waits for the session
  // to exist server-side instead of failing with "not found".
  const creating = new Map<string, Promise<unknown>>()

  // Per-session send chain: prompts and compactions must be admitted in
  // submission order. Each waits for the previous POST to settle, so one
  // failure does not block the next.
  const sending = new Map<string, Promise<unknown>>()
  const messageLoads = new Map<string, Promise<unknown>>()
  const compacting = new Map<string, { id: string; observed: Set<string>; request: Promise<SessionInboxCompaction> }>()
  onCleanup(() => compacting.clear())

  // Register `promise` under `key` until it settles. A later registration
  // replaces an earlier one; settlement only clears its own entry.
  function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
    map.set(key, promise)
    const settle = () => {
      if (map.get(key) === promise) map.delete(key)
    }
    void promise.then(settle, settle)
  }

  // Capture creation before settlement clears its entry, so dependent RPCs still see a failed create.
  function sendAdmission<Value>(sessionID: string, send: () => Promise<Value>, gate?: Promise<unknown>) {
    const created = creating.get(sessionID)
    const previous = sending.get(sessionID)
    const request = Promise.resolve()
      .then(() => Promise.all([gate, created, previous]))
      .then(send)
    track(
      sending,
      sessionID,
      request.catch(() => undefined),
    )
    return request
  }

  // Upsert an admitted inbox item into pending and (for user and synthetic
  // items) the visible transcript. Used by the inbox.enqueued
  // handler and by optimistic admission; the upsert is what reconciles
  // the durable echo with an optimistic placeholder — the durable payload and
  // times replace the client's guess.
  function admitLocal(item: SessionInboxInfo) {
    batch(() => {
      const pending = store.session.pending[item.sessionID] ?? []
      const at = pending.findIndex((entry) => entry.id === item.id)
      setStore(
        "session",
        "pending",
        item.sessionID,
        at < 0 ? [...pending, item] : pending.map((entry, index) => (index === at ? item : entry)),
      )
      if (item.type === "compaction") return
      materializeInboxMessage(item)
    })
  }

  function materializeInboxMessage(item: SessionInboxInfo) {
    if (item.type !== "user" && item.type !== "synthetic") return
    message.update(item.sessionID, (draft, index) => {
      const row =
        item.type === "user"
          ? { id: item.id, type: "user" as const, ...item.payload, time: { created: item.time.created } }
          : { id: item.id, type: "synthetic" as const, ...item.payload, time: { created: item.time.created } }
      const position = index.get(item.id)
      if (position === undefined) return message.append(draft, index, row)
      draft[position] = row
    })
  }

  // Remove an inbox item from pending, input, and the visible transcript.
  // Used by the inbox.cancelled handler and by optimistic rollback.
  function retractLocal(sessionID: string, inboxID: string) {
    batch(() => {
      removePending(sessionID, inboxID)
      if (!messageIndex.get(sessionID)?.has(inboxID)) return
      message.update(sessionID, (draft, index) => {
        const position = index.get(inboxID)
        if (position === undefined) return
        draft.splice(position, 1)
        index.delete(inboxID)
        message.reindex(draft, index, position)
      })
    })
  }

  const message = {
    update(sessionID: string, fn: (messages: SessionMessageInfo[], index: Map<string, number>) => void) {
      setStore(
        "session",
        "message",
        produce((draft) => {
          fn((draft[sessionID] ??= []), index(sessionID))
        }),
      )
    },
    append(messages: SessionMessageInfo[], index: Map<string, number>, item: SessionMessageInfo) {
      if (index.has(item.id)) return
      index.set(item.id, messages.length)
      messages.push(item)
    },
    insert(sessionID: string, item: SessionMessageInfo) {
      message.update(sessionID, (draft, index) => message.append(draft, index, item))
    },
    // Streaming events target one assistant message and, within it, the latest part of a kind.
    // A missing target means the row was never loaded or was evicted; the event is dropped.
    editAssistant(sessionID: string, messageID: string, fn: (assistant: SessionMessageAssistant) => void) {
      if (!messageIndex.get(sessionID)?.has(messageID)) return
      message.update(sessionID, (draft, index) => {
        const position = index.get(messageID)
        const item = position === undefined ? undefined : draft[position]
        if (item?.type === "assistant") fn(item)
      })
    },
    editTool(sessionID: string, messageID: string, toolID: string, fn: (tool: SessionMessageAssistantTool) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const tool = assistant.content.findLast(
          (item): item is SessionMessageAssistantTool => item.type === "tool" && item.id === toolID,
        )
        if (tool) fn(tool)
      })
    },
    editText(sessionID: string, messageID: string, fn: (text: SessionMessageAssistantText) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const text = assistant.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
        if (text) fn(text)
      })
    },
    editReasoning(sessionID: string, messageID: string, fn: (reasoning: SessionMessageAssistantReasoning) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const reasoning = assistant.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && !item.time?.completed,
        )
        if (reasoning) fn(reasoning)
      })
    },
    activeAssistant(messages: SessionMessageInfo[]) {
      const item = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
      return item?.type === "assistant" ? item : undefined
    },
    shell(messages: SessionMessageInfo[], shellID: string) {
      const item = messages.findLast((item) => item.type === "shell" && item.shellID === shellID)
      return item?.type === "shell" ? item : undefined
    },
    compaction(messages: SessionMessageInfo[]) {
      const item = messages.findLast((item) => item.type === "compaction" && item.status === "running")
      return item?.type === "compaction" ? item : undefined
    },
    reindex(messages: SessionMessageInfo[], index: Map<string, number>, start: number) {
      for (let position = start; position < messages.length; position++) {
        const item = messages[position]
        if (item) index.set(item.id, position)
      }
    },
  }

  function index(sessionID: string) {
    const existing = messageIndex.get(sessionID)
    if (existing) return existing
    const created = new Map<string, number>()
    messageIndex.set(sessionID, created)
    return created
  }

  // Every direct subagent, not only the server's default first page, so a root's family cost
  // counts all of them. Pages stay newest first, the order the family index has always used.
  async function listChildren(input: SessionListInput): Promise<SessionInfo[]> {
    const page = await api().session.list(input)

    if (page.data.length < CHILD_PAGE || !page.cursor.next) return page.data

    return [...page.data, ...(await listChildren({ cursor: page.cursor.next, limit: CHILD_PAGE }))]
  }

  // Walk parentID upward through loaded session info to the family root. When a
  // parent's info is missing, that missing ID is the furthest-known ancestor and
  // is returned so orphan subtrees group under it until the parent arrives. A
  // seen set guards against parent cycles, stopping at the last non-repeating
  // ancestor.
  function resolveRoot(sessionID: string) {
    let current = sessionID
    let parentID = store.session.info[sessionID]?.parentID
    const seen = new Set([sessionID])
    while (parentID) {
      if (seen.has(parentID)) break
      seen.add(parentID)
      current = parentID
      parentID = store.session.info[parentID]?.parentID
    }
    return current
  }

  // Register one session into the family index. Idempotent: syncing an
  // existing session never duplicates its ID. When a tentative family keyed by
  // sessionID exists (descendants arrived while sessionID's own info was
  // absent) but sessionID turns out to have a parent, fold the orphan subtree
  // into the resolved root's family and drop the tentative entry.
  function registerSession(sessionID: string) {
    const info = store.session.info[sessionID]
    if (!info) return
    const rootID = resolveRoot(sessionID)
    setStore(
      "session",
      "family",
      produce((draft) => {
        if (sessionID !== rootID && draft[sessionID]) {
          const members = (draft[rootID] ??= [])
          for (const id of draft[sessionID]) {
            if (!members.includes(id)) members.push(id)
          }
          delete draft[sessionID]
        }
        const family = (draft[rootID] ??= [])
        if (!family.includes(sessionID)) family.push(sessionID)
      }),
    )
  }

  function evictSession(sessionID: string) {
    if (sessionOutbox.has(sessionID)) return
    sync.invalidate(`session.pending:${sessionID}`)
    sync.invalidate(`session.message:${sessionID}`)
    messageLoads.delete(sessionID)
    // Keep unacknowledged submissions until their echo or rollback settles them.
    const pending = store.session.pending[sessionID]?.filter((item) => outbox.has(item.id)) ?? []
    const messages = store.session.message[sessionID]?.filter((item) => outbox.has(item.id)) ?? []
    messageIndex.delete(sessionID)
    if (messages.length) messageIndex.set(sessionID, new Map(messages.map((item, index) => [item.id, index])))
    setStore(
      "session",
      produce((draft) => {
        delete draft.message[sessionID]
        delete draft.messageCursor[sessionID]
        delete draft.messageLoading[sessionID]
        delete draft.pending[sessionID]
        if (messages.length) draft.message[sessionID] = messages
        if (pending.length) draft.pending[sessionID] = pending
      }),
    )
  }

  let deletionEpoch = 0
  const deletedAt = new Map<string, number>()

  function clearDeleted(sessionID: string) {
    deletedAt.delete(sessionID)
    if (store.session.missing[sessionID]) setStore("session", "missing", sessionID, undefined)
  }

  function markDeleted(sessionID: string) {
    if (sessionOutbox.has(sessionID)) return
    batch(() => {
      deletedAt.delete(sessionID)
      deletedAt.set(sessionID, ++deletionEpoch)
      if (deletedAt.size > DELETED_SESSION_LIMIT) {
        const oldest = deletedAt.keys().next().value
        if (oldest !== undefined) {
          deletedAt.delete(oldest)
          setStore("session", "missing", oldest, undefined)
        }
      }
      setStore("session", "missing", sessionID, true)
      removeSession(sessionID)
    })
  }

  function evictMissing(error: unknown): never {
    if (isSessionNotFoundError(error)) observe(error.sessionID, () => markDeleted(error.sessionID))
    throw error
  }

  function removeSession(sessionID: string) {
    activeUpdates?.set(sessionID, undefined)
    store.session.pending[sessionID]?.forEach((item) => outbox.delete(item.id))
    messageIndex.delete(sessionID)
    sync.invalidate(`session:${sessionID}`)
    sync.invalidate(`session.family:${sessionID}`)
    sync.invalidate(`session.pending:${sessionID}`)
    sync.invalidate(`session.message:${sessionID}`)
    sync.invalidate(`session.permission:${sessionID}`)
    sync.invalidate(`session.form:${sessionID}:`)
    setStore(
      "session",
      produce((draft) => {
        delete draft.info[sessionID]
        delete draft.active[sessionID]
        delete draft.message[sessionID]
        delete draft.messageCursor[sessionID]
        delete draft.messageLoading[sessionID]
        delete draft.pending[sessionID]
        delete draft.permission[sessionID]
        delete draft.form[sessionID]
        for (const [rootID, family] of Object.entries(draft.family)) {
          const next = family.filter((id) => id !== sessionID)
          if (next.length === 0) delete draft.family[rootID]
          else draft.family[rootID] = next
        }
      }),
    )
  }

  function handleEvent(event: OpenCodeEvent) {
    switch (event.type) {
      case "server.connected": {
        familyRouteMissing = false
        const updates = new Map<string, DataSessionStatus | undefined>()
        activeUpdates = updates
        refresh(() =>
          api()
            .session.active()
            .then((active) => {
              if (activeUpdates !== updates) return
              // Lifecycle events received during hydration supersede the snapshot.
              const snapshot = new Map<string, DataSessionStatus>(Object.keys(active).map((id) => [id, "running"]))
              updates.forEach((status, id) => {
                if (status === undefined) return snapshot.delete(id)
                snapshot.set(id, status)
              })
              activeUpdates = undefined
              setStore("session", "active", reconcile(Object.fromEntries(snapshot)))
              // Sessions created before this connection (while disconnected, or before the client started)
              // never delivered `session.created`; without their info a running child never joins its root's family.
              // Any member's ID reads the same family, so a Session that started during hydration names its own.
              new Set(
                [...snapshot].flatMap(([id, status]) =>
                  status === "running" && !store.session.info[id] ? [active[id]?.rootID ?? id] : [],
                ),
              ).forEach((rootID) => refresh(() => result.session.sync(rootID, { children: true })))
            })
            .catch(() => {
              if (activeUpdates === updates) activeUpdates = undefined
            }),
        )
        refresh(() =>
          api()
            .location.get({ location: locationQuery(defaultLocation()) })
            .then((location) => {
              const key = locationKey(location)
              setStore("location", key, { info: location })
            }),
        )
        refresh(() => result.location.vcs.sync())
        refresh(() => result.project.sync())
        return
      }
      case "project.updated":
        setStore("project", "info", event.data.id, reconcile(event.data))
        return
      case "session.created":
        sessionOutbox.delete(event.data.sessionID)
        // A family read that lands before this Session loads keeps it once it has loaded and joins the family.
        observe(
          event.data.sessionID,
          () => {
            clearDeleted(event.data.sessionID)
            registerSession(event.data.sessionID)
          },
          true,
        )
        result.session.invalidate(event.data.sessionID)
        refresh(() => result.session.sync(event.data.sessionID))
        // Band-aid: a newly created session starts empty, so live events can be its source of truth.
        // Fetching pending inputs and projected messages separately lets promotion move an input between snapshots,
        // causing both requests to miss it and overwrite event-built state. Skip those racy initial reads until
        // hydration can load pending and projected messages atomically.
        sync.complete(`session.pending:${event.data.sessionID}`)
        sync.complete(`session.message:${event.data.sessionID}`)
        return
      case "session.deleted":
        observe(event.data.sessionID, () => markDeleted(event.data.sessionID))
        return
      case "session.usage.updated":
        patchSession(event.data.sessionID, { cost: event.data.cost, tokens: event.data.tokens })
        return
      case "session.agent.selected": {
        const previous = store.session.info[event.data.sessionID]?.agent
        patchSession(event.data.sessionID, { agent: event.data.agent }, event.created)
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "agent-switched",
          agent: event.data.agent,
          previous,
          time: { created: event.created },
        })
        return
      }
      case "session.model.selected": {
        const previous = event.data.previous ?? store.session.info[event.data.sessionID]?.model
        patchSession(event.data.sessionID, { model: event.data.model }, event.created)
        if (!store.session.message[event.data.sessionID]) return
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "model-switched",
          model: event.data.model,
          previous,
          time: { created: event.created },
        })
        refresh(() =>
          api()
            .session.message.get({ sessionID: event.data.sessionID, messageID: SessionMessage.ID.fromEvent(event.id) })
            .then((item) => {
              message.update(event.data.sessionID, (draft, index) => {
                const position = index.get(item.id)
                if (position === undefined) return message.append(draft, index, item)
                draft[position] = item
              })
            }),
        )
        return
      }
      case "session.renamed":
        patchSession(event.data.sessionID, { title: event.data.title }, event.created)
        return
      case "session.permissions":
        patchSession(event.data.sessionID, { permissions: event.data.permissions }, event.created)
        return
      case "session.metadata.updated":
        // The event carries the whole record, so keys it drops must go too.
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "metadata", reconcile(event.data.metadata))
        return
      case "session.archived":
      case "session.unarchived":
        patchSession(event.data.sessionID, {}, event.created)
        observe(event.data.sessionID, () => {
          if (store.session.info[event.data.sessionID])
            setStore(
              "session",
              "info",
              event.data.sessionID,
              "time",
              "archived",
              event.type === "session.archived" ? event.created : undefined,
            )
        })
        return
      case "session.moved": {
        const current = store.session.info[event.data.sessionID]
        const previous = current && {
          location: { ...current.location },
          projectID: current.projectID,
          subpath: current.subpath,
        }
        patchSession(
          event.data.sessionID,
          { location: event.data.location, projectID: event.data.projectID, subpath: event.data.subpath },
          event.created,
        )
        if (previous) {
          message.insert(event.data.sessionID, {
            id: SessionMessage.ID.fromEvent(event.id),
            type: "location-switched",
            location: event.data.location,
            projectID: event.data.projectID,
            subpath: event.data.subpath,
            previous,
            time: { created: event.created },
          })
        }
        return
      }
      case "worktree.resolved": {
        for (const [sessionID, info] of Object.entries(store.session.info)) {
          const explicit = event.data.adopted?.includes(info.projectID)
          const directory = explicit ? store.project.info[info.projectID]?.canonical : info.location.directory
          if (!directory) {
            result.session.invalidate(sessionID)
            refresh(() => result.session.sync(sessionID))
            continue
          }
          const adopted = Worktree.adopt(
            {
              projectID: info.projectID,
              directory,
            },
            event.data,
          )
          if (!adopted) continue
          setStore("session", "info", sessionID, "projectID", adopted.projectID)
          setStore("session", "info", sessionID, "subpath", adopted.subpath)
        }
        return
      }
      case "session.inbox.delivered": {
        const admitted = result.session.input.has(event.data.sessionID, event.data.inboxID)
        removePending(event.data.sessionID, event.data.inboxID)
        message.update(event.data.sessionID, (draft, index) => {
          const position = index.get(event.data.inboxID)
          if (position === undefined) return
          const existing = draft[position]
          if (!existing || !admitted) return
          existing.time.created = event.created
          draft.splice(position, 1)
          draft.push(existing)
          message.reindex(draft, index, position)
        })
        compacting.get(event.data.sessionID)?.observed.add(event.data.inboxID)
        return
      }
      case "session.inbox.delivery.changed":
        updatePending(event.data.sessionID, event.data.inboxID, event.data.delivery)
        return
      case "session.inbox.cancelled": {
        retractLocal(event.data.sessionID, event.data.inboxID)
        compacting.get(event.data.sessionID)?.observed.add(event.data.inboxID)
        return
      }
      case "session.inbox.enqueued": {
        patchSession(event.data.sessionID, {}, event.created)
        outbox.delete(event.data.inboxID)
        const item = {
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          time: { created: event.created },
          ...event.data.item,
        }
        pendingUpdates.get(item.sessionID)?.set(item.id, item)
        admitLocal(item)
        if (event.data.item.type === "compaction") {
          const active = compacting.get(event.data.sessionID)
          active?.observed.add(event.data.inboxID)
          if (active && active.id !== event.data.inboxID && outbox.delete(active.id))
            removePending(event.data.sessionID, active.id)
        }
        return
      }
      case "session.instructions.updated":
        // Mirror the projector: the initial baseline and empty-rendering deltas carry no text
        // and produce no transcript message.
        const updateText = event.data.text
        if (updateText === undefined) return
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "system",
          text: updateText,
          description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
          metadata: event.metadata,
          time: { created: event.created },
        })
        return
      case "session.synthetic":
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "synthetic",
          text: event.data.text,
          description: event.data.description,
          metadata: event.data.metadata,
          time: { created: event.created },
        })
        return
      case "session.shell.started":
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "shell",
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          metadata:
            event.data.shell.metadata.background === true ? { ...event.metadata, background: true } : event.metadata,
          time: { created: event.created },
        })
        return
      case "session.shell.ended":
        if (!store.session.message[event.data.sessionID]) return
        message.update(event.data.sessionID, (draft) => {
          const match = message.shell(draft, event.data.shell.id)
          if (!match) return
          match.status = event.data.shell.status
          match.exit = event.data.shell.exit
          match.output = event.data.output
          match.time.completed = event.created
        })
        return
      case "session.step.started":
        patchSession(event.data.sessionID, {}, event.created)
        message.update(event.data.sessionID, (draft, index) => {
          const position = index.get(event.data.assistantMessageID)
          const existing = position === undefined ? undefined : draft[position]
          if (existing?.type === "assistant") {
            existing.agent = event.data.agent
            existing.model = event.data.model
            existing.retry = undefined
            existing.error = undefined
            existing.finish = undefined
            existing.rawFinish = undefined
            existing.native = undefined
            existing.time.created = event.data.started
            existing.time.streamed = undefined
            existing.time.completed = undefined
            if (event.data.snapshot) existing.snapshot = { ...existing.snapshot, start: event.data.snapshot }
            return
          }
          const currentAssistant = message.activeAssistant(draft)
          if (currentAssistant) {
            currentAssistant.retry = undefined
            currentAssistant.time.completed = event.created
          }
          message.append(draft, index, {
            id: event.data.assistantMessageID,
            type: "assistant",
            agent: event.data.agent,
            model: event.data.model,
            metadata: event.metadata,
            content: [],
            snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            time: { created: event.data.started },
          })
        })
        return
      case "session.step.streamed":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.streamed = event.created
        })
        return
      case "session.step.ended": {
        patchSession(event.data.sessionID, {}, event.created)
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.completed = event.created
          assistant.finish = event.data.finish
          assistant.rawFinish = event.data.rawFinish
          assistant.native = event.data.native
          assistant.cost = event.data.cost
          assistant.tokens = event.data.tokens
          if (event.data.snapshot) assistant.snapshot = { ...assistant.snapshot, end: event.data.snapshot }
        })
        return
      }
      case "session.step.failed":
        patchSession(event.data.sessionID, {}, event.created)
        // A budget refusal means the cached usage limits are out of date, which is what the refusal sends people to.
        if (
          event.location &&
          (event.data.error.type === "provider.budget-limit" || event.data.error.type === "provider.model-budget-limit")
        )
          refreshUsageLimits(event.location)
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.completed = event.created
          assistant.finish = event.data.finish ?? "error"
          assistant.rawFinish = event.data.rawFinish
          assistant.native = event.data.native
          assistant.error = event.data.error
          assistant.retry = undefined
          if (event.data.cost !== undefined && event.data.tokens !== undefined) {
            assistant.cost = event.data.cost
            assistant.tokens = event.data.tokens
          }
        })
        return
      case "session.text.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({ type: "text", text: "" })
        })
        return
      case "session.text.delta":
        message.editText(event.data.sessionID, event.data.assistantMessageID, (text) => {
          text.text += event.data.delta
        })
        return
      case "session.text.ended":
        message.editText(event.data.sessionID, event.data.assistantMessageID, (text) => {
          text.text = event.data.text
        })
        return
      case "session.tool.input.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            time: { created: event.created },
            state: { status: "streaming", input: "" },
          })
        })
        return
      case "session.tool.input.delta":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "streaming") tool.state.input += event.data.delta
        })
        return
      case "session.tool.input.ended":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "streaming") tool.state.input = event.data.text
        })
        return
      case "session.tool.called":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          tool.time.ran = event.created
          tool.executed = event.data.executed
          tool.native = event.data.native
          tool.state = { status: "running", input: event.data.input, metadata: {} }
        })
        return
      case "session.tool.progress":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "running") tool.state.metadata = event.data.metadata
        })
        return
      case "session.tool.success":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status !== "running") return
          tool.state = {
            status: "completed",
            input: tool.state.input,
            metadata: event.data.metadata,
            content: config.omitToolFileData ? omitFileData(event.data.content) : [...event.data.content],
          }
          tool.executed = event.data.executed || tool.executed === true
          if (event.data.native) tool.native = { ...tool.native, ...event.data.native }
          tool.time.completed = event.created
        })
        return
      case "session.tool.failed":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return
          tool.state = {
            status: "error",
            error: event.data.error,
            input: typeof tool.state.input === "string" ? {} : tool.state.input,
            metadata: event.data.metadata,
            content:
              config.omitToolFileData && event.data.content ? omitFileData(event.data.content) : event.data.content,
          }
          tool.executed = event.data.executed || tool.executed === true
          if (event.data.native) tool.native = { ...tool.native, ...event.data.native }
          tool.time.completed = event.created
        })
        return
      case "session.reasoning.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({
            type: "reasoning",
            text: "",
            native: event.data.native,
            time: { created: event.created },
          })
        })
        return
      case "session.reasoning.delta":
        message.editReasoning(event.data.sessionID, event.data.assistantMessageID, (reasoning) => {
          reasoning.text += event.data.delta
        })
        return
      case "session.reasoning.ended":
        message.editReasoning(event.data.sessionID, event.data.assistantMessageID, (reasoning) => {
          reasoning.text = event.data.text
          reasoning.time = { created: reasoning.time?.created ?? event.created, completed: event.created }
          if (event.data.native !== undefined) reasoning.native = event.data.native
        })
        return
      case "session.retry.scheduled":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.retry = { attempt: event.data.attempt, at: event.data.at, error: event.data.error }
        })
        return
      case "session.execution.started":
        observe(event.data.sessionID, () => {
          setSessionActive(event.data.sessionID, "running")
          const busy = store.session.info[event.data.sessionID]?.time.busy
          if (store.session.info[event.data.sessionID])
            setStore(
              "session",
              "info",
              event.data.sessionID,
              "time",
              "busy",
              Math.max(busy ?? event.created, event.created),
            )
        })
        return
      case "session.compaction.started":
        if (event.data.inputID) removePending(event.data.sessionID, event.data.inputID)
        message.insert(event.data.sessionID, {
          id: event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
          type: "compaction",
          status: "running",
          reason: event.data.reason,
          summary: "",
          time: { created: event.created },
        })
        if (event.data.inputID) compacting.get(event.data.sessionID)?.observed.add(event.data.inputID)
        return
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const shutdown = event.type === "session.execution.interrupted" && event.data.reason === "shutdown"
        const outcome =
          event.type === "session.execution.succeeded"
            ? "succeeded"
            : event.type === "session.execution.failed"
              ? "failed"
              : "interrupted"
        observe(event.data.sessionID, () => {
          setSessionActive(event.data.sessionID, "idle")
          const idle = store.session.info[event.data.sessionID]?.time.idle
          if (shutdown || !store.session.info[event.data.sessionID]) return
          // Idempotent, because reads replay it. It differs from the projector's `+1` bump only when two terminals
          // share a millisecond.
          if (event.created >= (idle ?? -Infinity))
            setStore("session", "info", event.data.sessionID, "outcome", outcome)
          setStore(
            "session",
            "info",
            event.data.sessionID,
            "time",
            "idle",
            Math.max(idle ?? event.created, event.created),
          )
        })
        message.update(event.data.sessionID, (draft) => {
          const currentAssistant = message.activeAssistant(draft)
          if (currentAssistant) currentAssistant.retry = undefined
        })
        if (shutdown) return
        // Mirror the projected idle marker so turn boundaries match before the next message read.
        message.insert(event.data.sessionID, {
          id: SessionMessage.ID.fromEvent(event.id),
          type: "idle",
          outcome,
          ...(event.type === "session.execution.failed" ? { error: event.data.error } : {}),
          time: { created: event.created },
        })
        if (
          store.session.message[event.data.sessionID]?.some(
            (item) =>
              item.type === "assistant" &&
              item.content.some(
                (part) =>
                  part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running"),
              ),
          )
        ) {
          sync.invalidate(`session.message:${event.data.sessionID}`)
          refresh(() => result.session.message.sync(event.data.sessionID))
        }
        return
      }
      case "session.viewed":
        observe(event.data.sessionID, () => {
          const viewed = store.session.info[event.data.sessionID]?.time.viewed
          if (store.session.info[event.data.sessionID])
            setStore(
              "session",
              "info",
              event.data.sessionID,
              "time",
              "viewed",
              Math.max(event.data.idle, viewed ?? event.data.idle),
            )
        })
        return
      case "session.revert.staged":
        patchSession(event.data.sessionID, { revert: event.data.revert }, event.created)
        return
      case "session.revert.cleared":
        patchSession(event.data.sessionID, { revert: undefined }, event.created)
        return
      case "session.revert.committed":
        patchSession(event.data.sessionID, { revert: undefined }, event.created)
        // The projector also deletes inbox items enqueued at or after the boundary without a cancel event.
        setStore(
          "session",
          "pending",
          event.data.sessionID,
          (store.session.pending[event.data.sessionID] ?? []).filter((item) => item.id < event.data.to),
        )
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findIndex((item) => item.id >= event.data.to)
          if (position === -1) return
          for (const item of draft.splice(position)) index.delete(item.id)
        })
        return
      case "session.compaction.delta":
        if (!store.session.message[event.data.sessionID]) return
        message.update(event.data.sessionID, (draft) => {
          const current = message.compaction(draft)
          if (current?.status === "running") current.summary += event.data.text
        })
        return
      case "session.compaction.ended":
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
          const current = draft[position]
          if (current?.type === "compaction") {
            Object.assign(current, {
              status: "completed",
              reason: event.data.reason,
              model: event.data.model,
              native: event.data.native,
              summary: event.data.text,
              cost: event.data.cost,
              tokens: event.data.tokens,
            })
            return
          }
          message.append(draft, index, {
            id: SessionMessage.ID.fromEvent(event.id),
            type: "compaction",
            status: "completed",
            reason: event.data.reason,
            model: event.data.model,
            native: event.data.native,
            summary: event.data.text,
            cost: event.data.cost,
            tokens: event.data.tokens,
            time: { created: event.created },
          })
        })
        return
      case "session.compaction.failed":
        if (event.data.inputID) removePending(event.data.sessionID, event.data.inputID)
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
          const current = draft[position]
          const failed: Extract<SessionMessageInfo, { type: "compaction"; status: "failed" }> = {
            id: current?.id ?? event.data.inputID ?? SessionMessage.ID.fromEvent(event.id),
            type: "compaction",
            status: "failed",
            reason: event.data.reason,
            error: event.data.error,
            metadata: current?.type === "compaction" ? current.metadata : event.metadata,
            cost: event.data.cost,
            tokens: event.data.tokens,
            time: current?.type === "compaction" ? current.time : { created: event.created },
          }
          if (current?.type === "compaction") {
            draft[position] = failed
            return
          }
          message.append(draft, index, failed)
        })
        if (event.data.inputID) compacting.get(event.data.sessionID)?.observed.add(event.data.inputID)
        return
      case "permission.asked":
        observe(event.data.sessionID, () => {
          if (store.session.permission[event.data.sessionID]?.some((request) => request.id === event.data.id)) return
          setStore("session", "permission", event.data.sessionID, [
            ...(store.session.permission[event.data.sessionID] ?? []),
            event.data,
          ])
        })
        return
      case "permission.replied":
        observe(event.data.sessionID, () => removePermission(event.data.sessionID, event.data.requestID))
        return
      case "form.replied":
      case "form.cancelled":
        observe(event.data.sessionID, () => removeForm(event.data.sessionID, event.data.id, event.location))
        return
    }

    if (event.type === "credential.updated" || event.type === "credential.switched") {
      Object.keys(store.location).forEach((key) => {
        const ref = JSON.parse(key) as [string, string | null]
        const location = { directory: ref[0], workspaceID: ref[1] ?? undefined }
        refreshUsageLimits(location)
        if (event.type === "credential.updated") {
          refreshLocation("integration", result.location.integration, location)
          return
        }
        if (store.location[key]?.integration)
          setStore("location", key, (data) => ({
            integration: data?.integration?.map((integration) => {
              if (integration.id !== event.data.integrationID) return integration
              const active = integration.connections.find(
                (connection) => connection.type === "credential" && connection.id === event.data.credentialID,
              )
              if (!active) return integration
              return {
                ...integration,
                connections: [active, ...integration.connections.filter((connection) => connection !== active)],
              }
            }),
          }))
        const active =
          hasLocation("integration", location) || hasLocation("model", location) || hasLocation("provider", location)
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        if (active)
          refresh(() => Promise.all([result.location.model.sync(location), result.location.provider.sync(location)]))
      })
      return
    }

    if (!event.location) return
    const location = event.location
    switch (event.type) {
      case "provider.updated":
        refreshLocation("provider", result.location.provider, location)
        break
      case "model.updated":
        refreshLocation("model", result.location.model, location)
        break
      case "agent.updated":
        refreshLocation("agent", result.location.agent, location)
        break
      case "command.updated":
        refreshLocation("command", result.location.command, location)
        break
      case "skill.updated":
        refreshLocation("skill", result.location.skill, location)
        break
      case "vcs.branch.updated":
        // The event names only the current branch. Reload the rest: the default branch and provider can change with
        // it, and a read served before the location's VCS provider loaded has neither.
        refreshLocation("vcs", result.location.vcs, location)
        break
      case "form.created": {
        const form = event.data.form
        observe(form.sessionID, () => {
          if (store.session.form[form.sessionID]?.some((item) => item.id === form.id)) return
          setStore("session", "form", form.sessionID, [
            ...(store.session.form[form.sessionID] ?? []),
            form.sessionID === "global" ? { ...form, location } : form,
          ])
        })
        break
      }
      case "shell.created":
        setStore("location", locationKey(location), (data) => ({
          shell: {
            ...data?.shell,
            [event.data.info.id]: { ...event.data.info, location },
          },
        }))
        break
      case "shell.exited":
      case "shell.deleted":
        if (!store.location[locationKey(location)]?.shell?.[event.data.id]) break
        setStore("location", locationKey(location), (data) => ({
          shell: Object.fromEntries(Object.entries(data?.shell ?? {}).filter(([id]) => id !== event.data.id)),
        }))
        break
      case "reference.updated":
        refreshLocation("reference", result.location.reference, location)
        break
      case "integration.updated": {
        refreshUsageLimits(location)
        const active =
          hasLocation("integration", location) || hasLocation("model", location) || hasLocation("provider", location)
        result.location.integration.invalidate(location)
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        if (active)
          refresh(() =>
            Promise.all([
              result.location.integration.sync(location),
              result.location.model.sync(location),
              result.location.provider.sync(location),
            ]),
          )
        break
      }
      case "config.updated":
        refreshLocation("config", result.location.config, location)
        if (hasLocation("websearch", location)) refresh(() => result.location.websearch.refresh(location))
        break
      case "websearch.updated":
        if (hasLocation("websearch", location)) refresh(() => result.location.websearch.refresh(location))
        break
      // Authenticating an MCP integration reconnects its server, which emits mcp.status.changed,
      // so the mcp list syncs here rather than off integration.updated. The server emits one event
      // per MCP server as each settles, so a location booting nine servers emitted nine refetches.
      case "mcp.status.changed": {
        const active = hasLocation("mcpServer", location)
        result.location.mcp.server.invalidate(location)
        if (active) settle(`mcp.status:${locationKey(location)}`, () => result.location.mcp.server.sync(location))
        break
      }
      case "mcp.resources.changed":
        refreshLocation("mcpResource", result.location.mcp.resource, location)
        break
    }
  }

  function hasLocation<Field extends keyof LocationData>(field: Field, ref?: LocationRef) {
    const id = locationKey(ref ?? defaultLocation())
    return store.location[id]?.[field] !== undefined || sync.has(`location.${field}:${id}`)
  }

  function refreshLocation<Field extends keyof LocationData>(
    field: Field,
    resource: { invalidate: (ref?: LocationRef) => void; sync: (ref?: LocationRef) => Promise<void> },
    location: LocationRef,
  ) {
    const active = hasLocation(field, location)
    resource.invalidate(location)
    if (active) refresh(() => resource.sync(location))
  }

  // A cached per-location catalog. `sync` loads once per invalidation, keyed by the
  // effective location, and publishes under the server's canonical location; `alias`
  // also publishes under the requested key when the two differ.
  // Reloads usage limits only where something has read them, since each load asks OpenCode Console.
  function refreshUsageLimits(location: LocationRef) {
    const loaded =
      store.location[locationKey(location)]?.usageLimits !== undefined ||
      sync.has(`location.usageLimits:${locationKey(location)}`)
    usageLimits.invalidate(location)
    if (loaded) refresh(() => usageLimits.sync(location))
  }

  function locationResource<Field extends keyof LocationData>(
    field: Field,
    load: (location: ReturnType<typeof locationQuery>) => Promise<{ location: LocationRef; data: LocationData[Field] }>,
    options?: { alias?: boolean },
  ) {
    const publish = (key: string, value: LocationData[Field]) => setStore("location", key, { [field]: value })
    return {
      list: (ref?: LocationRef) => store.location[locationKey(ref ?? defaultLocation())]?.[field],
      sync: (ref?: LocationRef) => {
        const location = ref ?? defaultLocation()
        const id = locationKey(location)
        return sync.run(`location.${field}:${id}`, async () => {
          const response = await load(locationQuery(location))
          const key = locationKey(response.location)
          publish(key, response.data)
          if (options?.alias && key !== id) publish(id, response.data)
        })
      },
      invalidate: (ref?: LocationRef) => sync.invalidate(`location.${field}:${locationKey(ref ?? defaultLocation())}`),
    }
  }

  const vcs = locationResource("vcs", (location) => api().vcs.get({ location }))
  const usageLimits = locationResource("usageLimits", (location) => api().experimental.usage.limits({ location }))
  const shells = locationResource("shell", async (location) => {
    const response = await api().shell.list({ location })
    const ref = { directory: response.location.directory }
    return {
      location: response.location,
      data: Object.fromEntries(response.data.map((info) => [info.id, { ...info, location: ref }])),
    }
  })

  const result = {
    on: config.event.on,
    listen: config.event.listen,
    session: {
      list() {
        return sessions()
      },
      get(sessionID: string) {
        return store.session.info[sessionID]
      },
      missing(sessionID: string) {
        return Boolean(store.session.missing[sessionID])
      },
      forget(sessionID: string) {
        observe(sessionID, () => markDeleted(sessionID))
      },
      creating(sessionID: string) {
        return creating.has(sessionID)
      },
      remember(info: SessionInfo) {
        batch(() => {
          clearDeleted(info.id)
          setStore("session", "info", info.id, reconcile(info))
          sync.complete(`session:${info.id}`)
          registerSession(info.id)
        })
      },
      setStatus(sessionID: string, status: DataSessionStatus) {
        setSessionActive(sessionID, status)
      },
      root(sessionID: string) {
        return resolveRoot(sessionID)
      },
      family(sessionID: string) {
        return store.session.family[resolveRoot(sessionID)] ?? []
      },
      /** Clear heavy cached data for the root and all known descendants. */
      evict(sessionID: string) {
        const root = resolveRoot(sessionID)
        batch(() => {
          for (const id of new Set([root, sessionID, ...(store.session.family[root] ?? [])])) evictSession(id)
        })
      },
      cost(sessionID: string) {
        const session = store.session.info[sessionID]
        if (!session) return 0
        if (session.parentID) return session.cost
        return (store.session.family[sessionID] ?? [sessionID]).reduce(
          (total, id) => total + (store.session.info[id]?.cost ?? 0),
          0,
        )
      },
      status(sessionID: string) {
        return store.session.active[sessionID] ?? "idle"
      },
      active() {
        return Object.entries(store.session.active).flatMap(([sessionID, status]) =>
          status === "running" ? [sessionID] : [],
        )
      },
      // Inputs are the pending user and synthetic items; compactions are control items.
      input: {
        list(sessionID: string) {
          return (store.session.pending[sessionID] ?? []).flatMap((item) =>
            item.type === "compaction" ? [] : [item.id],
          )
        },
        has(sessionID: string, inboxID: string) {
          return (
            store.session.pending[sessionID]?.some((item) => item.id === inboxID && item.type !== "compaction") ?? false
          )
        },
      },
      pending: {
        list(sessionID: string) {
          return store.session.pending[sessionID] ?? []
        },
        // An execution's idle boundary promotes every pending steer at once, so a steer only waits behind work
        // once the current execution has delivered input.
        status(sessionID: string, inboxID: string): DataPendingStatus | undefined {
          const pending = store.session.pending[sessionID] ?? []
          const item = pending.find((entry) => entry.id === inboxID && entry.type === "user")
          if (!item) return undefined
          if (item.delivery === "queue") return "queued"
          const messages = store.session.message[sessionID] ?? []
          const boundary = messages.findLastIndex((entry) => entry.type === "idle")
          if ((store.session.active[sessionID] ?? "idle") === "idle")
            return boundary >= 0 && item.time.created <= messages[boundary].time.created ? "stranded" : "starting"
          return messages
            .slice(boundary + 1)
            .some((entry) => entry.type === "user" && !pending.some((other) => other.id === entry.id))
            ? "steering"
            : "starting"
        },
        sync(sessionID: string) {
          return sync.run(`session.pending:${sessionID}`, async () => {
            const started = deletionEpoch
            const updates = new Map<string, SessionInboxInfo | SessionInbox.Delivery | undefined>()
            pendingUpdates.set(sessionID, updates)
            try {
              const snapshot = await api().session.inbox.list({ sessionID }).catch(evictMissing)
              if ((deletedAt.get(sessionID) ?? 0) > started) return
              // Events can overtake this HTTP response on a remote connection.
              // Reconcile them before an older snapshot can resurrect delivered input.
              const current = new Map(snapshot.map((item) => [item.id, item]))
              updates.forEach((item, id) => {
                if (item === undefined) current.delete(id)
                else if (typeof item === "string") {
                  const existing = current.get(id)
                  if (existing) current.set(id, { ...existing, delivery: item })
                } else current.set(id, item)
              })
              const pending = [...current.values()]
              // A positive read acknowledges admission even when its SSE echo is delayed.
              pending.forEach((item) => outbox.delete(item.id))
              // Compactions also coalesce by Session, not just by the proposed ID.
              if (pending.some((item) => item.type === "compaction"))
                store.session.pending[sessionID]
                  ?.filter((item) => item.type === "compaction")
                  .forEach((item) => outbox.delete(item.id))
              // Keep optimistic rows still awaiting their echo: this fetch may
              // have raced ahead of an in-flight admission the server does not
              // know about yet.
              const inflight = (store.session.pending[sessionID] ?? []).filter((item) => outbox.has(item.id))
              const merged = inflight.length === 0 ? pending : [...pending, ...inflight]
              batch(() => {
                setStore("session", "pending", sessionID, reconcile(merged))
                merged.forEach(materializeInboxMessage)
              })
            } finally {
              if (pendingUpdates.get(sessionID) === updates) pendingUpdates.delete(sessionID)
            }
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.pending:${sessionID}`)
        },
      },
      // Optimistic session creation: admit a local record under a
      // client-minted ID so a session view can mount immediately, then create
      // the session on the server. The session.created echo re-syncs the
      // record by ID, so the durable payload replaces the client's guess.
      // Returns the ID synchronously along with the in-flight request:
      // callers gate session-dependent sends on the request (prompt() gates
      // itself on any in-flight create of its session automatically).
      create(input: {
        id?: string
        title?: string
        agent?: string
        model?: ModelRef
        location?: LocationRef
        projectID?: string
      }) {
        const { projectID, ...payload } = input
        const id = payload.id ?? SessionID.create()
        const location = payload.location ?? defaultLocation()
        const fresh = !store.session.info[id]
        clearDeleted(id)
        if (fresh) {
          const now = Date.now()
          sessionOutbox.add(id)
          result.session.remember({
            id,
            projectID: projectID ?? store.location[locationKey(location)]?.info?.project.id ?? "",
            agent: payload.agent,
            model: payload.model,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: now, updated: now },
            title: payload.title,
            location,
            status: "idle",
          })
          // A mounted optimistic session must not fetch its empty collections
          // before creation settles. The session.created echo re-syncs info.
          sync.complete(`session.family:${id}`)
          sync.complete(`session.pending:${id}`)
          sync.complete(`session.message:${id}`)
        }
        // Wrapped so even a synchronous client failure reaches the rollback.
        const request = Promise.resolve()
          .then(() => api().session.create({ ...payload, id, location }))
          .then((info) => {
            sessionOutbox.delete(id)
            result.session.remember(info)
            return info
          })
          .catch((error) => {
            // Roll back only a record this call admitted and neither the echo
            // nor the response has acknowledged: anything else is server state.
            if (fresh && sessionOutbox.delete(id)) removeSession(id)
            throw error
          })
        if (fresh) track(creating, id, request)
        return { id, request }
      },
      compact(input: { sessionID: string; model?: ModelRef }) {
        const active = compacting.get(input.sessionID)
        if (active) return active.request
        // A known pending control ID may be consumed while setup waits. Propose
        // a fresh ID and let the server coalesce, without duplicating its row.
        const id = SessionMessage.ID.create()
        if (!store.session.pending[input.sessionID]?.some((item) => item.type === "compaction")) {
          outbox.add(id)
          admitLocal({
            id,
            sessionID: input.sessionID,
            time: { created: Date.now() },
            type: "compaction",
            delivery: "steer",
            payload: {},
          })
        }
        // Compaction admission can coalesce onto a different ID. Retire the
        // speculative row on an echo, and remember consumed IDs until the POST
        // settles so its older response cannot resurrect a queued row.
        const observed = new Set<string>()
        const request = sendAdmission(input.sessionID, async () => {
          if (input.model) await api().session.switchModel({ sessionID: input.sessionID, model: input.model })
          return api().session.compact({ sessionID: input.sessionID, id })
        })
          .then((item) => {
            batch(() => {
              outbox.delete(id)
              if (item.id !== id) removePending(input.sessionID, id)
              if (!observed.has(item.id) && !messageIndex.get(input.sessionID)?.has(item.id)) admitLocal(item)
            })
            return item
          })
          .catch((error) => {
            if (outbox.delete(id)) removePending(input.sessionID, id)
            throw error
          })
          .finally(() => {
            if (compacting.get(input.sessionID)?.request === request) compacting.delete(input.sessionID)
          })
        compacting.set(input.sessionID, { id, observed, request })
        return request
      },
      // Optimistic prompt admission: render the prompt immediately under a
      // client-minted ID, send it, and let the durable inbox.enqueued echo
      // upsert that same ID with the server's payload. Server admission is
      // idempotent per ID, so retrying with the identical payload cannot
      // double-admit.
      prompt(input: SessionPromptInput & { gate?: Promise<unknown>; prepare?: () => Promise<unknown> }) {
        const { gate, prepare, ...request } = input
        const id = request.id ?? SessionMessage.ID.create()
        // A retry may reuse an ID that is already rendered — and possibly
        // already durable. Admit optimistically only for new IDs so a failed
        // retry cannot roll back acknowledged state.
        const fresh =
          !messageIndex.get(request.sessionID)?.has(id) &&
          !store.session.pending[request.sessionID]?.some((item) => item.id === id)
        if (fresh) {
          const files = optimisticFiles(request.files)
          const payload: Extract<SessionInboxInfo, { type: "user" }>["payload"] = {
            text: request.text,
            agents: request.agents?.map((agent) => ({ ...agent })),
            metadata: request.metadata,
          }
          if (files) payload.files = files
          outbox.add(id)
          admitLocal({
            id,
            sessionID: request.sessionID,
            time: { created: Date.now() },
            type: "user",
            delivery: request.delivery ?? "steer",
            // File-URI attachments and skills stay off the optimistic row: their durable
            // forms are server-loaded (content, mime, resolution), so they
            // fill in when the echo upserts the row. Inline data URLs already carry
            // their mime and base64 payload, so they render immediately.
            payload,
          })
        }
        return sendAdmission(
          request.sessionID,
          async () => {
            await prepare?.()
            return api().session.prompt({ ...request, id })
          },
          gate,
        ).catch((error) => {
          // Roll back only rows this call admitted and the server has not
          // acknowledged: anything else is server state.
          if (fresh && outbox.delete(id)) retractLocal(request.sessionID, id)
          throw error
        })
      },
      sync(sessionID: string, options?: { children?: boolean }) {
        if (!options?.children)
          return sync.run(`session:${sessionID}`, () =>
            observeRead(
              () => api().session.get({ sessionID }).catch(evictMissing),
              (info) => {
                clearDeleted(info.id)
                setStore("session", "info", info.id, reconcile(info))
                registerSession(info.id)
                return (id) => id === info.id
              },
            ),
          )
        // The family's membership is unknown until the read lands, so events for every Session are recorded.
        return sync.run(`session.family:${sessionID}`, (stale) => {
          // Servers without the family route: the Session and its direct children, merged into what is already known.
          // Status comes only from /session/active and events, and pending requests are read per member.
          const fallback = async () => {
            const loaded: string[] = []
            await observeRead(
              () =>
                Promise.all([
                  api().session.get({ sessionID }).catch(evictMissing),
                  listChildren({ parentID: sessionID, order: "desc", limit: CHILD_PAGE }),
                ]).then(([info, children]) => [info, ...children]),
              (sessions) => {
                for (const session of sessions) {
                  clearDeleted(session.id)
                  setStore("session", "info", session.id, reconcile(session))
                  registerSession(session.id)
                  sync.complete(`session:${session.id}`)
                  loaded.push(session.id)
                }
                return (id) => loaded.includes(id)
              },
              stale,
            )
            // Read every known member's pending requests, but wait only for the requested Session's. Older servers fail
            // a member's reads when its worktree is gone; the other members still load.
            const pending = (id: string) => [result.session.permission.sync(id), result.session.form.sync(id)]
            void Promise.allSettled(
              [...new Set([...loaded, ...(store.session.family[resolveRoot(sessionID)] ?? [])])]
                .filter((id) => id !== sessionID)
                .flatMap(pending),
            )
            await Promise.allSettled(pending(sessionID))
          }
          if (familyRouteMissing) return fallback()
          return observeRead(
            () => api().experimental.sessionFamily.get({ sessionID }).catch(evictMissing),
            (family, journal) => {
              const ids = new Set(family.sessions.map((session) => session.id))
              // Members the server no longer lists were deleted while this client could not hear it. Sessions created
              // during the read rejoin when their creation replays, and unacknowledged local creations stay.
              const created = new Set(journal.flatMap((entry) => (entry.created ? [entry.sessionID] : [])))
              const gone = [family.rootID, ...ids]
                .flatMap((id) => store.session.family[id] ?? [])
                .filter((id) => !ids.has(id) && !created.has(id) && !sessionOutbox.has(id))
              gone.forEach((id) => markDeleted(id))
              setStore(
                "session",
                "info",
                produce((draft) => {
                  for (const session of family.sessions) draft[session.id] = session
                }),
              )
              const local = [...sessionOutbox].filter(
                (id) => !ids.has(id) && store.session.info[id] && resolveRoot(id) === family.rootID,
              )
              setStore(
                "session",
                "family",
                produce((draft) => {
                  for (const id of ids) if (id !== family.rootID) delete draft[id]
                  draft[family.rootID] = [...ids, ...local]
                }),
              )
              for (const session of family.sessions) {
                clearDeleted(session.id)
                // Older servers omit status; /session/active and events then remain the only source.
                if (session.status) setStore("session", "active", session.id, session.status)
                setStore(
                  "session",
                  "permission",
                  session.id,
                  family.permissions.filter((request) => request.sessionID === session.id),
                )
                setStore(
                  "session",
                  "form",
                  session.id,
                  family.forms.filter((form) => form.sessionID === session.id),
                )
                sync.complete(`session:${session.id}`)
                sync.complete(`session.family:${session.id}`)
                sync.complete(`session.permission:${session.id}`)
                sync.complete(`session.form:${session.id}:`)
              }
              return (id) => resolveRoot(id) === family.rootID
            },
            // A read invalidated in flight is superseded by a newer one, and its older snapshot would undo that read.
            stale,
          ).catch((error: unknown) => {
            if (!isMissingRoute(error)) throw error
            if (stale()) return
            familyRouteMissing = true
            return fallback()
          })
        })
      },
      invalidate(sessionID: string) {
        sync.invalidate(`session:${sessionID}`)
      },
      message: {
        list(sessionID: string) {
          return store.session.message[sessionID] ?? []
        },
        get(sessionID: string, messageID: string) {
          const messages = store.session.message[sessionID]
          const position = messageIndex.get(sessionID)?.get(messageID)
          return position === undefined ? undefined : messages?.[position]
        },
        sync(sessionID: string) {
          return sync.run(`session.message:${sessionID}`, async () => {
            const started = deletionEpoch
            const response = await api()
              .message.list({
                sessionID,
                limit: config.initialMessageLimit?.() ?? messagePageLimit,
                order: "desc",
              })
              .catch(evictMissing)
            if ((deletedAt.get(sessionID) ?? 0) > started) return
            const fetched = response.data.toReversed().map(stored)
            // Same protection as the pending sync: a re-fetch racing an
            // admission must not wipe its local transcript row.
            const ids = new Set(fetched.map((item) => item.id))
            const admitted = new Set(
              (store.session.pending[sessionID] ?? []).flatMap((item) =>
                item.type === "user" || item.type === "synthetic" ? [item.id] : [],
              ),
            )
            const local = (store.session.message[sessionID] ?? []).filter(
              (item) => !ids.has(item.id) && (outbox.has(item.id) || admitted.has(item.id)),
            )
            const messages = local.length === 0 ? fetched : [...fetched, ...local]
            batch(() => {
              messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
              setStore("session", "message", sessionID, reconcile(messages))
              setStore("session", "messageCursor", sessionID, response.cursor.next ?? undefined)
            })
          })
        },
        more(sessionID: string) {
          return store.session.messageCursor[sessionID] !== undefined
        },
        loading(sessionID: string) {
          return store.session.messageLoading[sessionID] ?? false
        },
        async loadMore(
          sessionID: string,
          options?: {
            all?: boolean
            signal?: AbortSignal
            /** Runs synchronously inside the store-publication batch. */
            beforePublish?: () => void
          },
        ) {
          const signal = options?.signal
          if (signal?.aborted) return
          while (messageLoads.has(sessionID)) {
            const published = await (() => {
              const pending = messageLoads.get(sessionID)
              if (!signal) return pending
              const aborted = Promise.withResolvers<void>()
              const cancel = () => aborted.resolve()
              signal.addEventListener("abort", cancel, { once: true })
              return Promise.race([pending, aborted.promise])
                .catch((error) => {
                  if (!signal.aborted) throw error
                })
                .finally(() => signal.removeEventListener("abort", cancel))
            })()
            if ((!options?.all && published) || signal?.aborted) return
          }
          const cursor = store.session.messageCursor[sessionID]
          if (!cursor || signal?.aborted) return
          setStore("session", "messageLoading", sessionID, true)
          const request = (async () => {
            const fetched: SessionMessageInfo[] = []
            let next: string | undefined = cursor
            do {
              const response = await api().message.list(
                {
                  sessionID,
                  limit: options?.all ? 200 : messagePageLimit,
                  cursor: next,
                },
                { signal },
              )
              if (signal?.aborted) return
              fetched.push(...response.data.map(stored))
              next = response.cursor.next ?? undefined
              if (!options?.all) break
            } while (next)
            // A jump through history publishes once, not once per page of offscreen messages.
            const existing = store.session.message[sessionID] ?? []
            const ids = new Set(existing.map((item) => item.id))
            const messages = [...fetched.reverse().filter((item) => !ids.has(item.id)), ...existing]
            batch(() => {
              options?.beforePublish?.()
              messageIndex.set(sessionID, new Map(messages.map((item, position) => [item.id, position])))
              setStore("session", "message", sessionID, reconcile(messages))
              setStore("session", "messageCursor", sessionID, next)
            })
            return true
          })()
            .catch((error) => {
              if (!signal?.aborted) throw error
            })
            .finally(() => setStore("session", "messageLoading", sessionID, false))
          track(messageLoads, sessionID, request)
          await request
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.message:${sessionID}`)
        },
      },
      permission: {
        list(sessionID: string) {
          return store.session.permission[sessionID]
        },
        sessions() {
          return Object.entries(store.session.permission).flatMap(([sessionID, requests]) =>
            requests.length > 0 ? [sessionID] : [],
          )
        },
        sync(sessionID: string) {
          return sync.run(`session.permission:${sessionID}`, () =>
            observeRead(
              () => api().permission.list({ sessionID }).catch(evictMissing),
              (requests) => {
                setStore("session", "permission", sessionID, requests)
                return (id) => id === sessionID
              },
            ),
          )
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.permission:${sessionID}`)
        },
        async reply(input: PermissionReplyInput) {
          await api()
            .permission.reply(input)
            .catch((error: unknown) => {
              if (!isPermissionNotFoundError(error)) throw error
            })
          removePermission(input.sessionID, input.requestID)
        },
      },
      form: {
        list(sessionID: string, ref?: LocationRef) {
          const forms = store.session.form[sessionID]
          if (sessionID !== "global") return forms
          if (!ref) return
          const key = locationKey(ref)
          return forms?.filter((form) => form.location && locationKey(form.location) === key)
        },
        sessions() {
          return Object.entries(store.session.form).flatMap(([sessionID, forms]) =>
            sessionID !== "global" && forms.length > 0 ? [sessionID] : [],
          )
        },
        sync(sessionID: string, ref?: LocationRef) {
          const key = `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`
          return sync.run(key, async () => {
            if (sessionID === "global") {
              const response = await api().form.list({
                location: locationQuery(ref ?? defaultLocation()),
              })
              const location = {
                directory: response.location.directory,
              }
              const locationID = locationKey(location)
              setStore("session", "form", sessionID, [
                ...(store.session.form[sessionID] ?? []).filter(
                  (form) => form.location && locationKey(form.location) !== locationID,
                ),
                ...response.data.filter((form) => form.sessionID === "global").map((form) => ({ ...form, location })),
              ])
              return
            }
            await observeRead(
              () => api().session.form.list({ sessionID }).catch(evictMissing),
              (forms) => {
                setStore("session", "form", sessionID, forms)
                return (id) => id === sessionID
              },
            )
          })
        },
        invalidate(sessionID: string, ref?: LocationRef) {
          sync.invalidate(
            `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`,
          )
        },
        reply(input: SessionFormReplyInput, ref?: LocationRef) {
          return settleForm(input, ref, api().session.form.reply(input, formRequestOptions(input.sessionID, ref)))
        },
        cancel(input: SessionFormCancelInput, ref?: LocationRef) {
          return settleForm(input, ref, api().session.form.cancel(input, formRequestOptions(input.sessionID, ref)))
        },
      },
    },
    project: {
      list() {
        return Object.values(store.project.info)
          .filter((project) => project.time.archived === undefined)
          .toSorted((a, b) => b.time.active - a.time.active)
      },
      get(projectID: string) {
        return store.project.info[projectID]
      },
      sync() {
        return sync.run("project", async () => {
          const projects = await api().project.list()
          setStore("project", "info", reconcile(Object.fromEntries(projects.map((project) => [project.id, project]))))
        })
      },
      invalidate() {
        sync.invalidate("project")
      },
      permission: {
        list(projectID: string) {
          return store.project.permission[projectID]
        },
        sync(projectID: string) {
          return sync.run(`project.permission:${projectID}`, async () => {
            setStore("project", "permission", projectID, await api().permission.saved.list({ projectID }))
          })
        },
        invalidate(projectID: string) {
          sync.invalidate(`project.permission:${projectID}`)
        },
      },
    },
    shell: {
      list(location?: LocationRef) {
        return Object.values(shells.list(location) ?? {})
      },
      listBySession(sessionID: string) {
        return Object.values(store.location)
          .flatMap((data) => Object.values(data.shell ?? {}))
          .filter((shell) => shell.metadata.sessionID === sessionID)
      },
      get(id: string) {
        return Object.values(store.location)
          .map((data) => data.shell?.[id])
          .find((shell) => shell !== undefined)
      },
      sync: shells.sync,
      invalidate: shells.invalidate,
    },
    location: {
      info(ref?: LocationRef) {
        return store.location[locationKey(ref ?? defaultLocation())]?.info
      },
      default() {
        return defaultLocation()
      },
      syncInfo(ref?: LocationRef) {
        const current = ref ?? defaultLocation()
        return sync.run(`location:${locationKey(current)}`, async () => {
          const location = await api().location.get({ location: locationQuery(current) })
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          setStore("location", key, "info", location)
          if (!ref) {
            setDefaultLocation({ directory: location.directory })
          }
        })
      },
      async sync(ref?: LocationRef) {
        await result.location.syncInfo(ref)
        const location = ref ?? defaultLocation()
        await Promise.all([
          result.location.vcs.sync(location),
          result.location.agent.sync(location),
          result.location.command.sync(location),
          result.location.integration.sync(location),
          result.location.mcp.server.sync(location),
          result.location.mcp.resource.sync(location),
          result.location.model.sync(location),
          result.location.provider.sync(location),
          result.location.reference.sync(location),
          result.location.skill.sync(location),
          result.shell.sync(location),
          result.session.form.sync("global", location),
        ])
      },
      invalidate(ref?: LocationRef) {
        const location = ref ?? defaultLocation()
        sync.invalidate(`location:${locationKey(location)}`)
        result.location.vcs.invalidate(location)
        result.location.agent.invalidate(location)
        result.location.command.invalidate(location)
        result.location.config.invalidate(location)
        result.location.integration.invalidate(location)
        result.location.mcp.server.invalidate(location)
        result.location.mcp.resource.invalidate(location)
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        result.location.reference.invalidate(location)
        result.location.skill.invalidate(location)
        result.shell.invalidate(location)
        result.session.form.invalidate("global", location)
      },
      vcs: { info: vcs.list, sync: vcs.sync, invalidate: vcs.invalidate },
      usage: { limits: usageLimits.list, sync: usageLimits.sync, invalidate: usageLimits.invalidate },
      agent: locationResource("agent", (location) => api().agent.list({ location })),
      command: locationResource("command", (location) => api().command.list({ location })),
      config: locationResource("config", async (location) => ({
        location: { directory: location.directory },
        data: await api().config.get({ location }),
      })),
      integration: locationResource("integration", (location) => api().integration.list({ location })),
      mcp: {
        server: locationResource("mcpServer", (location) => api().mcp.list({ location })),
        resource: locationResource("mcpResource", async (location) => {
          const response = await api().mcp.resource.catalog({ location })
          return { location: response.location, data: response.data.resources }
        }),
      },
      model: locationResource("model", (location) => api().model.list({ location }), { alias: true }),
      provider: locationResource("provider", (location) => api().provider.list({ location }), { alias: true }),
      reference: locationResource("reference", (location) => api().reference.list({ location })),
      websearch: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.websearch
        },
        async refresh(ref?: LocationRef) {
          const input = { location: locationQuery(ref ?? defaultLocation()) }
          const providers = await api().websearch.providers(input)
          const key = locationKey(providers.location)
          setStore("location", key, { websearch: providers.data })
        },
      },
      skill: locationResource("skill", (location) => api().skill.list({ location })),
    },
  }

  createEffect(() => {
    if (config.connection?.status() === "connected") return
    sync.invalidate()
  })

  onCleanup(
    config.event.listen(({ details }) => {
      handleEvent(details)
    }),
  )

  return result
}

export type Data = ReturnType<typeof createData>
