// Client data layer: apply server events and cache API reads into a Solid store.
// Prefer straightforward projection. Invalidated reads revalidate serially so an older
// response cannot commit after its replacement. Reconnect invalidates cached reads;
// active UI owners decide what to sync again.

import type {
  AgentInfo,
  CommandInfo,
  FormCancelInput,
  FormInfo,
  FormReplyInput,
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
  SessionInboxInfo,
  ShellInfo,
  SkillInfo,
  VcsInfo,
  OpenCodeEvent,
  OpenCodeClient,
  WebSearchProvider,
} from "../promise"
import { Worktree } from "@opencode-ai/schema/worktree"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import {
  isFormAlreadySettledError,
  isFormNotFoundError,
  isPermissionNotFoundError,
  type SessionPromptInput,
} from "../promise"
import { createStore, produce, reconcile } from "solid-js/store"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

export type DataSessionStatus = "idle" | "running"

export type CreateDataInput = {
  readonly api: () => OpenCodeClient
  readonly directory: string
  readonly event: {
    readonly on: <Type extends OpenCodeEvent["type"]>(
      type: Type,
      handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
    ) => () => void
    readonly listen: (handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) => () => void
  }
  readonly connection?: {
    readonly status: () => "connected" | "connecting" | "reconnecting"
  }
}

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, "msg_")
const messagePageLimit = 20

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
  integration?: IntegrationInfo[]
  mcp?: {
    server?: McpServer[]
    resource?: McpResource[]
  }
  model?: ModelInfo[]
  provider?: ProviderInfo[]
  reference?: ReferenceInfo[]
  websearch?: WebSearchProvider[]
  // Currently running shell commands for this location, keyed by shell id. Entries are removed
  // once the command exits or is deleted, so this only ever holds in-flight shells.
  shell?: Record<string, ShellWithLocation>
  skill?: SkillInfo[]
}

type Store = {
  session: {
    info: Record<string, SessionInfo>
    // Family index keyed by a family's root (or furthest-known-ancestor when the
    // true root is not yet loaded). The value is a flat deduplicated list of every
    // session ID in that family, including the key itself once its info arrives.
    family: Record<string, string[]>
    active: Record<string, DataSessionStatus>
    message: Record<string, SessionMessageInfo[]>
    messageCursor: Record<string, string | undefined>
    messageLoading: Record<string, boolean>
    pending: Record<string, SessionInboxInfo[]>
    input: Record<string, string[]>
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

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

function formRequestOptions(sessionID: string, ref?: LocationRef) {
  if (sessionID !== "global" || !ref) return undefined
  return {
    headers: {
      "x-opencode-directory": encodeURIComponent(ref.directory),
      ...(ref.workspaceID ? { "x-opencode-workspace": ref.workspaceID } : {}),
    },
  }
}

function createSync() {
  type Pending = { promise: Promise<void>; invalidated: boolean }
  const state = new Map<string, true | Pending>()
  const start = (key: string, load: () => Promise<void>, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false }
    state.set(key, entry)
    entry.promise = (wait ? wait.catch(() => undefined).then(load) : load())
      .then(() => {
        if (state.get(key) === entry) state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    return entry.promise
  }
  return {
    run(key: string, load: () => Promise<void>) {
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
        if (active !== undefined && active !== true) active.invalidated = true
        return
      }
      state.forEach((active, current) => {
        if (active === true) state.delete(current)
        if (active !== true) active.invalidated = true
      })
    },
  }
}

export function createData(config: CreateDataInput) {
  const api = config.api

  const [store, setStore] = createStore<Store>({
    session: {
      info: {},
      family: {},
      active: {},
      message: {},
      messageCursor: {},
      messageLoading: {},
      pending: {},
      input: {},
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
  const sync = createSync()

  function setSessionActive(sessionID: string, status: DataSessionStatus) {
    setStore("session", "active", sessionID, status)
  }

  function removePending(sessionID: string, inboxID?: string) {
    if (!inboxID) return
    if (store.session.pending[sessionID]?.some((item) => item.id === inboxID))
      setStore(
        "session",
        "pending",
        sessionID,
        (store.session.pending[sessionID] ?? []).filter((item) => item.id !== inboxID),
      )
    if (store.session.input[sessionID]?.includes(inboxID))
      setStore(
        "session",
        "input",
        sessionID,
        (store.session.input[sessionID] ?? []).filter((id) => id !== inboxID),
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

  function settleForm(input: FormCancelInput, ref: LocationRef | undefined, request: Promise<void>) {
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
    if (index < 0 || !item || item.delivery === delivery) return
    setStore("session", "pending", sessionID, index, { ...item, delivery })
  }

  // Inbox IDs of optimistic prompt admissions still awaiting their durable
  // echo. This is the one deliberate piece of in-flight bookkeeping in this
  // layer: it exists so a rejection only rolls back rows the server never
  // acknowledged, and so a concurrent pending re-fetch cannot wipe a row the
  // server does not know about yet. Entries clear on the enqueued echo or on
  // rollback — not on POST success, which typically precedes the echo.
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

  // Per-session send chain: prompts must be admitted in submission order,
  // and HTTP gives no ordering across concurrent POSTs. Each prompt waits
  // for the previous prompt's POST (settled, so one failure does not block
  // the next) before sending its own.
  const sending = new Map<string, Promise<unknown>>()

  // Register `promise` under `key` until it settles. A later registration
  // replaces an earlier one; settlement only clears its own entry.
  function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
    map.set(key, promise)
    const settle = () => {
      if (map.get(key) === promise) map.delete(key)
    }
    void promise.then(settle, settle)
  }

  // Upsert an admitted inbox item into pending, input, and (for user and
  // synthetic items) the visible transcript. Used by the inbox.enqueued
  // handler and by optimistic prompt admission; the upsert is what reconciles
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
      const input = store.session.input[item.sessionID] ?? []
      if (!input.includes(item.id)) setStore("session", "input", item.sessionID, [...input, item.id])
      materializeInboxMessage(item)
    })
  }

  function materializeInboxMessage(item: SessionInboxInfo) {
    if (item.type !== "user" && item.type !== "synthetic") return
    message.update(item.sessionID, (draft, index) => {
      const row =
        item.type === "user"
          ? { id: item.id, type: "user" as const, ...item.payload, time: { created: item.timeCreated } }
          : { id: item.id, type: "synthetic" as const, ...item.payload, time: { created: item.timeCreated } }
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
    activeAssistant(messages: SessionMessageInfo[]) {
      const item = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
      return item?.type === "assistant" ? item : undefined
    },
    assistant(messages: SessionMessageInfo[], index: Map<string, number>, messageID: string) {
      const position = index.get(messageID)
      const item = position === undefined ? undefined : messages[position]
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
    latestTool(assistant: SessionMessageAssistant | undefined, id?: string) {
      return assistant?.content.findLast(
        (item): item is SessionMessageAssistantTool => item.type === "tool" && (id === undefined || item.id === id),
      )
    },
    latestText(assistant: SessionMessageAssistant | undefined) {
      return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
    },
    latestReasoning(assistant: SessionMessageAssistant | undefined) {
      return assistant?.content.findLast(
        (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && !item.time?.completed,
      )
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

  function removeSession(sessionID: string) {
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
        delete draft.input[sessionID]
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
      case "server.connected":
        void api()
          .session.active()
          .then((active) => {
            setStore(
              "session",
              "active",
              reconcile(Object.fromEntries(Object.keys(active).map((sessionID) => [sessionID, "running" as const]))),
            )
          })
          .catch(() => undefined)
        void api()
          .location.get({ location: locationQuery(defaultLocation()) })
          .then((location) => {
            const key = locationKey(location)
            setStore("location", key, { ...store.location[key], info: location })
          })
          .catch((error) => console.error("Failed to preload location", error))
        void result.location.vcs.sync().catch((error) => console.error("Failed to preload VCS info", error))
        void result.project.sync().catch((error) => console.error("Failed to preload projects", error))
        return
      case "session.created":
        sessionOutbox.delete(event.data.sessionID)
        result.session.invalidate(event.data.sessionID)
        void result.session.sync(event.data.sessionID)
        // Band-aid: a newly created session starts empty, so live events can be its source of truth.
        // Fetching pending inputs and projected messages separately lets promotion move an input between snapshots,
        // causing both requests to miss it and overwrite event-built state. Skip those racy initial reads until
        // hydration can load pending and projected messages atomically.
        sync.complete(`session.pending:${event.data.sessionID}`)
        sync.complete(`session.message:${event.data.sessionID}`)
        return
      case "session.deleted":
        removeSession(event.data.sessionID)
        return
      case "session.usage.updated":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, {
            cost: event.data.cost,
            tokens: event.data.tokens,
          })
        return
      case "session.agent.selected": {
        const previous = store.session.info[event.data.sessionID]?.agent
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "agent", event.data.agent)
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "agent-switched",
            agent: event.data.agent,
            previous,
            time: { created: event.created },
          })
        })
        return
      }
      case "session.model.selected":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "model", event.data.model)
        if (!store.session.message[event.data.sessionID]) return
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "model-switched",
            model: event.data.model,
            time: { created: event.created },
          })
        })
        void api()
          .session.message({ sessionID: event.data.sessionID, messageID: messageIDFromEvent(event.id) })
          .then((item) => {
            message.update(event.data.sessionID, (draft, index) => {
              const position = index.get(item.id)
              if (position === undefined) return message.append(draft, index, item)
              draft[position] = item
            })
          })
          .catch((error) => console.error("Failed to load projected model switch message", error))
        return
      case "session.renamed":
        // Preserve the live title when it races the session's initial read.
        void result.session.sync(event.data.sessionID).then(() => {
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "title", event.data.title)
        })
        return
      case "session.moved": {
        const current = store.session.info[event.data.sessionID]
        if (current) {
          const previous = {
            location: { ...current.location },
            projectID: current.projectID,
            subpath: current.subpath,
          }
          setStore("session", "info", event.data.sessionID, "location", event.data.location)
          if (event.data.projectID) setStore("session", "info", event.data.sessionID, "projectID", event.data.projectID)
          setStore("session", "info", event.data.sessionID, "subpath", event.data.subpath)
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "location-switched",
              location: event.data.location,
              projectID: event.data.projectID,
              subpath: event.data.subpath,
              previous,
              time: { created: event.created },
            })
          })
        }
        return
      }
      case "worktree.resolved": {
        for (const [sessionID, info] of Object.entries(store.session.info)) {
          const adopted = Worktree.adopt({ projectID: info.projectID, directory: info.location.directory }, event.data)
          if (!adopted) continue
          setStore("session", "info", sessionID, "projectID", adopted.projectID)
          setStore("session", "info", sessionID, "subpath", adopted.subpath)
        }
        return
      }
      case "session.inbox.delivered": {
        const admitted = store.session.input[event.data.sessionID]?.includes(event.data.inboxID) ?? false
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
        return
      }
      case "session.inbox.delivery.changed":
        updatePending(event.data.sessionID, event.data.inboxID, event.data.delivery)
        return
      case "session.inbox.cancelled": {
        retractLocal(event.data.sessionID, event.data.inboxID)
        return
      }
      case "session.inbox.enqueued": {
        outbox.delete(event.data.inboxID)
        admitLocal({
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          timeCreated: event.created,
          ...event.data.item,
        })
        return
      }
      case "session.instructions.updated":
        // Mirror the projector: the initial baseline and empty-rendering deltas carry no text
        // and produce no transcript message.
        const updateText = event.data.text
        if (updateText === undefined) return
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "system",
            text: updateText,
            description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
            metadata: event.metadata,
            time: { created: event.created },
          })
        })
        return
      case "session.synthetic":
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "synthetic",
            text: event.data.text,
            description: event.data.description,
            metadata: event.data.metadata,
            time: { created: event.created },
          })
        })
        return
      case "session.shell.started":
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "shell",
            shellID: event.data.shell.id,
            command: event.data.shell.command,
            status: event.data.shell.status,
            exit: event.data.shell.exit,
            metadata: event.metadata,
            time: { created: event.created },
          })
        })
        return
      case "session.shell.ended":
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
            existing.providerState = undefined
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
            time: { created: event.created },
          })
        })
        return
      case "session.step.ended": {
        message.update(event.data.sessionID, (draft, index) => {
          const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
          if (!currentAssistant) return
          currentAssistant.time.completed = event.created
          currentAssistant.finish = event.data.finish
          currentAssistant.rawFinish = event.data.rawFinish
          currentAssistant.providerState = event.data.providerState
          currentAssistant.cost = event.data.cost
          currentAssistant.tokens = event.data.tokens
          if (event.data.snapshot)
            currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
        })
        return
      }
      case "session.step.failed":
        message.update(event.data.sessionID, (draft, index) => {
          const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
          if (!currentAssistant) return
          currentAssistant.time.completed = event.created
          currentAssistant.finish = event.data.finish ?? "error"
          currentAssistant.rawFinish = event.data.rawFinish
          currentAssistant.providerState = event.data.providerState
          currentAssistant.error = event.data.error
          currentAssistant.retry = undefined
          if (event.data.cost !== undefined && event.data.tokens !== undefined) {
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
          }
        })
        return
      case "session.text.started":
        message.update(event.data.sessionID, (draft, index) => {
          message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
            type: "text",
            text: "",
          })
        })
        return
      case "session.text.delta":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestText(message.assistant(draft, index, event.data.assistantMessageID))
          if (match) match.text += event.data.delta
        })
        return
      case "session.text.ended":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestText(message.assistant(draft, index, event.data.assistantMessageID))
          if (match) match.text = event.data.text
        })
        return
      case "session.tool.input.started":
        message.update(event.data.sessionID, (draft, index) => {
          message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            time: { created: event.created },
            state: { status: "streaming", input: "" },
          })
        })
        return
      case "session.tool.input.delta":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (match?.state.status === "streaming") match.state.input += event.data.delta
        })
        return
      case "session.tool.input.ended":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (match?.state.status === "streaming") match.state.input = event.data.text
        })
        return
      case "session.tool.called":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (!match) return
          match.time.ran = event.created
          match.executed = event.data.executed
          match.providerState = event.data.state
          match.state = { status: "running", input: event.data.input, metadata: {} }
        })
        return
      case "session.tool.progress":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (match?.state.status !== "running") return
          match.state.metadata = event.data.metadata
        })
        return
      case "session.tool.success":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (match?.state.status !== "running") return
          match.state = {
            status: "completed",
            input: match.state.input,
            metadata: event.data.metadata,
            content: [...event.data.content],
          }
          match.executed = event.data.executed || match.executed === true
          match.providerResultState = event.data.resultState
          match.time.completed = event.created
        })
        return
      case "session.tool.failed":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestTool(
            message.assistant(draft, index, event.data.assistantMessageID),
            event.data.id,
          )
          if (!match || (match.state.status !== "streaming" && match.state.status !== "running")) return
          match.state = {
            status: "error",
            error: event.data.error,
            input: typeof match.state.input === "string" ? {} : match.state.input,
            metadata: event.data.metadata,
            content: event.data.content,
          }
          match.executed = event.data.executed || match.executed === true
          match.providerResultState = event.data.resultState
          match.time.completed = event.created
        })
        return
      case "session.reasoning.started":
        message.update(event.data.sessionID, (draft, index) => {
          message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          })
        })
        return
      case "session.reasoning.delta":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestReasoning(message.assistant(draft, index, event.data.assistantMessageID))
          if (match) match.text += event.data.delta
        })
        return
      case "session.reasoning.ended":
        message.update(event.data.sessionID, (draft, index) => {
          const match = message.latestReasoning(message.assistant(draft, index, event.data.assistantMessageID))
          if (match) {
            match.text = event.data.text
            match.time = { created: match.time?.created ?? event.created, completed: event.created }
            if (event.data.state !== undefined) match.state = event.data.state
          }
        })
        return
      case "session.retry.scheduled":
        message.update(event.data.sessionID, (draft, index) => {
          const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
          if (!currentAssistant) return
          currentAssistant.retry = {
            attempt: event.data.attempt,
            at: event.data.at,
            error: event.data.error,
          }
        })
        return
      case "session.execution.started":
        setSessionActive(event.data.sessionID, "running")
        return
      case "session.compaction.started":
        if (event.data.inputID) removePending(event.data.sessionID, event.data.inputID)
        message.update(event.data.sessionID, (draft, index) => {
          message.append(draft, index, {
            id: event.data.inputID ?? messageIDFromEvent(event.id),
            type: "compaction",
            status: "running",
            reason: event.data.reason,
            summary: "",
            recent: event.data.recent ?? "",
            time: { created: event.created },
          })
        })
        return
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        setSessionActive(event.data.sessionID, "idle")
        message.update(event.data.sessionID, (draft) => {
          const currentAssistant = message.activeAssistant(draft)
          if (currentAssistant) currentAssistant.retry = undefined
        })
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
        // An event can overtake the first read; queue a revalidation when that read is still active.
        if (!store.session.info[event.data.sessionID] && !sync.has(`session:${event.data.sessionID}`)) return
        result.session.invalidate(event.data.sessionID)
        void result.session.sync(event.data.sessionID)
        return
      case "session.viewed":
        if (!store.session.info[event.data.sessionID] && !sync.has(`session:${event.data.sessionID}`)) return
        result.session.invalidate(event.data.sessionID)
        void result.session.sync(event.data.sessionID)
        return
      case "session.revert.staged":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "revert", event.data.revert)
        return
      case "session.revert.cleared":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "revert", undefined)
        return
      case "session.revert.committed":
        if (store.session.info[event.data.sessionID]) {
          setStore("session", "info", event.data.sessionID, "revert", undefined)
        }
        setStore(
          "session",
          "input",
          event.data.sessionID,
          (store.session.input[event.data.sessionID] ?? []).filter((id) => id < event.data.to),
        )
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findIndex((item) => item.id >= event.data.to)
          if (position === -1) return
          for (const item of draft.splice(position)) index.delete(item.id)
        })
        return
      case "session.compaction.delta":
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
              summary: event.data.text,
              recent: event.data.recent,
            })
            return
          }
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "compaction",
            status: "completed",
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
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
            id: current?.id ?? event.data.inputID ?? messageIDFromEvent(event.id),
            type: "compaction",
            status: "failed",
            reason: event.data.reason ?? "manual",
            error: event.data.error ?? {
              type: "compaction.failed",
              message: "Compaction failed before recording an error",
            },
            metadata: current?.type === "compaction" ? current.metadata : event.metadata,
            time: current?.type === "compaction" ? current.time : { created: event.created },
          }
          if (current?.type === "compaction") {
            draft[position] = failed
            return
          }
          message.append(draft, index, failed)
        })
        return
      case "permission.asked":
        if (store.session.permission[event.data.sessionID]?.some((request) => request.id === event.data.id)) return
        setStore("session", "permission", event.data.sessionID, [
          ...(store.session.permission[event.data.sessionID] ?? []),
          event.data,
        ])
        return
      case "permission.replied":
        removePermission(event.data.sessionID, event.data.requestID)
        return
      case "form.replied":
      case "form.cancelled":
        removeForm(event.data.sessionID, event.data.id, event.location)
        return
    }

    if (!event.location) return
    const location = event.location
    switch (event.type) {
      case "catalog.updated":
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        void Promise.all([result.location.model.sync(location), result.location.provider.sync(location)])
        break
      case "agent.updated":
        result.location.agent.invalidate(location)
        void result.location.agent.sync(location)
        break
      case "command.updated":
        result.location.command.invalidate(location)
        void result.location.command.sync(location)
        break
      case "skill.updated":
        result.location.skill.invalidate(location)
        void result.location.skill.sync(location)
        break
      case "vcs.branch.updated":
        setStore("location", locationKey(location), (data) => ({
          ...data,
          vcs: {
            branch: {
              ...data?.vcs?.branch,
              current: event.data.branch,
            },
          },
        }))
        break
      case "form.created":
        if (store.session.form[event.data.form.sessionID]?.some((form) => form.id === event.data.form.id)) break
        setStore("session", "form", event.data.form.sessionID, [
          ...(store.session.form[event.data.form.sessionID] ?? []),
          event.data.form.sessionID === "global" ? { ...event.data.form, location } : event.data.form,
        ])
        break
      case "shell.created":
        setStore("location", locationKey(location), (data) => ({
          ...data,
          shell: {
            ...data?.shell,
            [event.data.info.id]: { ...event.data.info, location },
          },
        }))
        break
      case "shell.exited":
      case "shell.deleted":
        setStore("location", locationKey(location), (data) => ({
          ...data,
          shell: Object.fromEntries(Object.entries(data?.shell ?? {}).filter(([id]) => id !== event.data.id)),
        }))
        break
      case "reference.updated":
        result.location.reference.invalidate()
        void result.location.reference.sync()
        break
      case "integration.updated":
        result.location.integration.invalidate(location)
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        void Promise.all([
          result.location.integration.sync(location),
          result.location.model.sync(location),
          result.location.provider.sync(location),
        ])
        break
      case "config.updated":
      case "websearch.updated":
        void result.location.websearch.refresh(location)
        break
      // Authenticating an MCP integration reconnects its server, which emits mcp.status.changed,
      // so the mcp list syncs here rather than off integration.updated.
      case "mcp.status.changed":
        result.location.mcp.server.invalidate(location)
        void result.location.mcp.server.sync(location)
        break
      case "mcp.resources.changed":
        result.location.mcp.resource.invalidate(location)
        void result.location.mcp.resource.sync(location)
        break
    }
  }

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
      creating(sessionID: string) {
        return creating.has(sessionID)
      },
      remember(info: SessionInfo) {
        setStore("session", "info", info.id, reconcile(info))
        sync.complete(`session:${info.id}`)
        registerSession(info.id)
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
      input: {
        list(sessionID: string) {
          return store.session.input[sessionID] ?? []
        },
        has(sessionID: string, inboxID: string) {
          return store.session.input[sessionID]?.includes(inboxID) ?? false
        },
      },
      pending: {
        list(sessionID: string) {
          return store.session.pending[sessionID] ?? []
        },
        sync(sessionID: string) {
          return sync.run(`session.pending:${sessionID}`, async () => {
            const pending = await api().session.inbox.list({ sessionID })
            // Keep optimistic rows still awaiting their echo: this fetch may
            // have raced ahead of an in-flight admission the server does not
            // know about yet.
            const inflight = (store.session.pending[sessionID] ?? []).filter(
              (item) => outbox.has(item.id) && !pending.some((row) => row.id === item.id),
            )
            const merged = inflight.length === 0 ? pending : [...pending, ...inflight]
            batch(() => {
              setStore("session", "pending", sessionID, reconcile(merged))
              setStore(
                "session",
                "input",
                sessionID,
                reconcile(merged.filter((item) => item.type !== "compaction").map((item) => item.id)),
              )
              merged.forEach(materializeInboxMessage)
            })
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
      // Optimistic prompt admission: render the prompt immediately under a
      // client-minted ID, send it, and let the durable inbox.enqueued echo
      // upsert that same ID with the server's payload. Server admission is
      // idempotent per ID, so retrying with the identical payload cannot
      // double-admit.
      prompt(input: SessionPromptInput & { gate?: Promise<unknown> }) {
        const { gate, ...request } = input
        const id = request.id ?? SessionMessage.ID.create()
        // A retry may reuse an ID that is already rendered — and possibly
        // already durable. Admit optimistically only for new IDs so a failed
        // retry cannot roll back acknowledged state.
        const fresh =
          !messageIndex.get(request.sessionID)?.has(id) &&
          !store.session.pending[request.sessionID]?.some((item) => item.id === id)
        if (fresh) {
          outbox.add(id)
          admitLocal({
            id,
            sessionID: request.sessionID,
            timeCreated: Date.now(),
            type: "user",
            delivery: request.delivery ?? "steer",
            // Files and skills stay off the optimistic row: their durable
            // forms are server-loaded (content, mime, resolution), so they
            // fill in when the echo upserts the row.
            payload: {
              text: request.text,
              agents: request.agents?.map((agent) => ({ ...agent })),
              metadata: request.metadata,
            },
          })
        }
        // Wrapped so even a synchronous client failure reaches the rollback.
        // The POST additionally waits for the caller's gate, for any
        // in-flight optimistic create of this session, and for the previous
        // prompt's POST: the row renders now, the send happens once the
        // session exists server-side and earlier prompts are admitted.
        const previous = sending.get(request.sessionID)
        const send = Promise.resolve()
          .then(() => Promise.all([gate, creating.get(request.sessionID), previous]))
          .then(() => api().session.prompt({ ...request, id }))
        track(
          sending,
          request.sessionID,
          send.then(
            () => undefined,
            () => undefined,
          ),
        )
        return send.catch((error) => {
          // Roll back only rows this call admitted and the echo has not
          // acknowledged: anything else is server state.
          if (fresh && outbox.delete(id)) retractLocal(request.sessionID, id)
          throw error
        })
      },
      sync(sessionID: string, options?: { children?: boolean }) {
        return sync.run(options?.children ? `session.family:${sessionID}` : `session:${sessionID}`, async () => {
          const [info, children] = await Promise.all([
            api().session.get({ sessionID }),
            options?.children
              ? api()
                  .session.list({ parentID: sessionID, order: "desc" })
                  .then((response) => response.data)
              : [],
          ])
          const sessions = [info, ...children]
          setStore(
            "session",
            "info",
            produce((draft) => {
              for (const session of sessions) draft[session.id] = session
            }),
          )
          for (const session of sessions) {
            sync.complete(`session:${session.id}`)
            registerSession(session.id)
          }
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
            const response = await api().message.list({ sessionID, limit: messagePageLimit, order: "desc" })
            const fetched = response.data.toReversed()
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
            messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
            setStore("session", "message", sessionID, reconcile(messages))
            setStore("session", "messageCursor", sessionID, response.cursor.next ?? undefined)
          })
        },
        more(sessionID: string) {
          return store.session.messageCursor[sessionID] !== undefined
        },
        loading(sessionID: string) {
          return store.session.messageLoading[sessionID] ?? false
        },
        async loadMore(sessionID: string) {
          const cursor = store.session.messageCursor[sessionID]
          if (!cursor || store.session.messageLoading[sessionID]) return
          setStore("session", "messageLoading", sessionID, true)
          const response = await api()
            .message.list({ sessionID, limit: messagePageLimit, cursor })
            .finally(() => setStore("session", "messageLoading", sessionID, false))
          const older = response.data.toReversed()
          const existing = store.session.message[sessionID] ?? []
          const ids = new Set(existing.map((item) => item.id))
          const messages = [...older.filter((item) => !ids.has(item.id)), ...existing]
          messageIndex.set(sessionID, new Map(messages.map((item, position) => [item.id, position])))
          setStore("session", "message", sessionID, reconcile(messages))
          setStore("session", "messageCursor", sessionID, response.cursor.next ?? undefined)
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.message:${sessionID}`)
        },
      },
      permission: {
        list(sessionID: string) {
          return store.session.permission[sessionID]
        },
        sync(sessionID: string) {
          return sync.run(`session.permission:${sessionID}`, async () => {
            setStore("session", "permission", sessionID, await api().permission.list({ sessionID }))
          })
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
        sync(sessionID: string, ref?: LocationRef) {
          const key = `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`
          return sync.run(key, async () => {
            if (sessionID === "global") {
              const response = await api().form.request.list({
                location: locationQuery(ref ?? defaultLocation()),
              })
              const location = {
                directory: response.location.directory,
                workspaceID: response.location.workspaceID,
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
            setStore("session", "form", sessionID, await api().form.list({ sessionID }))
          })
        },
        invalidate(sessionID: string, ref?: LocationRef) {
          sync.invalidate(
            `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`,
          )
        },
        reply(input: FormReplyInput, ref?: LocationRef) {
          return settleForm(input, ref, api().form.reply(input, formRequestOptions(input.sessionID, ref)))
        },
        cancel(input: FormCancelInput, ref?: LocationRef) {
          return settleForm(input, ref, api().form.cancel(input, formRequestOptions(input.sessionID, ref)))
        },
      },
    },
    project: {
      list() {
        return Object.values(store.project.info).toSorted((a, b) => b.time.updated - a.time.updated)
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
        return Object.values(store.location[locationKey(location ?? defaultLocation())]?.shell ?? {})
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
      sync(ref?: LocationRef) {
        const id = locationKey(ref ?? defaultLocation())
        return sync.run(`location.shell:${id}`, async () => {
          const response = await api().shell.list({ location: locationQuery(ref ?? defaultLocation()) })
          const key = locationKey(response.location)
          setStore("location", key, {
            ...store.location[key],
            shell: Object.fromEntries(
              response.data.map((info) => [
                info.id,
                {
                  ...info,
                  location: {
                    directory: response.location.directory,
                    workspaceID: response.location.workspaceID,
                  },
                },
              ]),
            ),
          })
        })
      },
      invalidate(ref?: LocationRef) {
        sync.invalidate(`location.shell:${locationKey(ref ?? defaultLocation())}`)
      },
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
            setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
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
      vcs: {
        info(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.vcs
        },
        sync(ref?: LocationRef) {
          const location = ref ?? defaultLocation()
          return sync.run(`location.vcs:${locationKey(location)}`, async () => {
            const response = await api().vcs.get({ location: locationQuery(location) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], vcs: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.vcs:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      agent: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.agent
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.agent:${id}`, async () => {
            const response = await api().agent.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], agent: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.agent:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      command: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.command
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.command:${id}`, async () => {
            const response = await api().command.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], command: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.command:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      integration: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.integration
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.integration:${id}`, async () => {
            const response = await api().integration.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], integration: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.integration:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      mcp: {
        server: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.mcp?.server
          },
          sync(ref?: LocationRef) {
            const id = locationKey(ref ?? defaultLocation())
            return sync.run(`location.mcp.server:${id}`, async () => {
              const response = await api().mcp.list({ location: locationQuery(ref ?? defaultLocation()) })
              const key = locationKey(response.location)
              setStore("location", key, {
                ...store.location[key],
                mcp: { ...store.location[key]?.mcp, server: response.data },
              })
            })
          },
          invalidate(ref?: LocationRef) {
            sync.invalidate(`location.mcp.server:${locationKey(ref ?? defaultLocation())}`)
          },
        },
        resource: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.mcp?.resource
          },
          sync(ref?: LocationRef) {
            const id = locationKey(ref ?? defaultLocation())
            return sync.run(`location.mcp.resource:${id}`, async () => {
              const response = await api().mcp.resource.catalog({
                location: locationQuery(ref ?? defaultLocation()),
              })
              const key = locationKey(response.location)
              setStore("location", key, {
                ...store.location[key],
                mcp: { ...store.location[key]?.mcp, resource: response.data.resources },
              })
            })
          },
          invalidate(ref?: LocationRef) {
            sync.invalidate(`location.mcp.resource:${locationKey(ref ?? defaultLocation())}`)
          },
        },
      },
      model: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.model
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.model:${id}`, async () => {
            const response = await api().model.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], model: response.data })
            if (key !== id) setStore("location", id, { ...store.location[id], model: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.model:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      provider: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.provider
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.provider:${id}`, async () => {
            const response = await api().provider.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], provider: response.data })
            if (key !== id) setStore("location", id, { ...store.location[id], provider: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.provider:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      reference: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.reference
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.reference:${id}`, async () => {
            const response = await api().reference.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], reference: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.reference:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      websearch: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.websearch
        },
        async refresh(ref?: LocationRef) {
          const input = { location: locationQuery(ref ?? defaultLocation()) }
          const providers = await api().websearch.providers(input)
          const key = locationKey(providers.location)
          setStore("location", key, {
            ...store.location[key],
            websearch: providers.data,
          })
        },
      },
      skill: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.skill
        },
        sync(ref?: LocationRef) {
          const id = locationKey(ref ?? defaultLocation())
          return sync.run(`location.skill:${id}`, async () => {
            const response = await api().skill.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(response.location)
            setStore("location", key, { ...store.location[key], skill: response.data })
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.skill:${locationKey(ref ?? defaultLocation())}`)
        },
      },
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
