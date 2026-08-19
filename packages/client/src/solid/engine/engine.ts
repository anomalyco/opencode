import type {
  EventLogSynced,
  SessionCompactionDelta,
  SessionInboxInfo,
  SessionInboxItem,
  SessionMessageInfo,
  SessionPromptInput,
  SessionReasoningDelta,
  SessionTextDelta,
  SessionToolInputDelta,
  SessionToolProgress,
  SessionUsageUpdated,
} from "../../promise"
import { SessionFold } from "./fold"
import type { DurableSessionEvent, SessionFoldState, SessionSnapshot } from "./fold"

export type EphemeralSessionEvent =
  | SessionTextDelta
  | SessionReasoningDelta
  | SessionToolInputDelta
  | SessionToolProgress
  | SessionCompactionDelta
  | SessionUsageUpdated

export type SessionStreamItem = DurableSessionEvent | EphemeralSessionEvent | EventLogSynced

export type Intent = {
  readonly id: string
  readonly item: Extract<SessionInboxItem, { readonly type: "user" | "synthetic" }>
  readonly request: Omit<SessionPromptInput, "sessionID" | "id">
  readonly created: number
}

export type SubmitInput = {
  readonly id: string
  readonly sessionID: string
  readonly request: Intent["request"]
}

export type IntentFailure = {
  readonly intent: Intent
  readonly reason: string
}

export class SubmitRejected extends Error {
  readonly _tag = "SubmitRejected"

  constructor(readonly reason: string) {
    super(reason)
  }
}

export class SeqUnavailable extends Error {
  readonly _tag = "SeqUnavailable"
}

export interface SessionTransport {
  readonly snapshot: (sessionID: string) => Promise<SessionSnapshot>
  readonly stream: (sessionID: string, after: number, signal?: AbortSignal) => AsyncIterable<SessionStreamItem>
  readonly submit: (input: SubmitInput) => Promise<void>
}

export type SessionView = SessionFoldState & {
  readonly pending: ReadonlyArray<SessionInboxInfo>
}

export interface SessionEngine {
  readonly sessionID: string
  readonly view: () => SessionView
  readonly submit: (input: Intent["request"] & { readonly id?: string }) => Intent
  readonly subscribe: (listener: (view: SessionView) => void) => () => void
  readonly subscribeFailures: (listener: (failure: IntentFailure) => void) => () => void
  readonly ready: () => Promise<void>
  readonly refresh: () => Promise<void>
  readonly settled: () => Promise<void>
  readonly stop: () => void
}

export type SessionEngineOptions = {
  readonly makeID?: () => string
  readonly now?: () => number
  readonly reconnect?: () => Promise<void>
}

type Overlay = ReadonlyMap<string, OverlayEntry>

type OverlayEntry =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "reasoning"; readonly value: string }
  | { readonly type: "tool-input"; readonly value: string }
  | { readonly type: "tool-progress"; readonly metadata: SessionToolProgress["data"]["metadata"] }
  | { readonly type: "compaction"; readonly value: string }
  | { readonly type: "usage"; readonly value: SessionUsageUpdated["data"] }

type EngineState = {
  readonly folded: SessionFoldState
  readonly outbox: ReadonlyArray<Intent>
  readonly overlay: Overlay
  readonly synced: boolean
}

export async function createSessionEngine(
  sessionID: string,
  transport: SessionTransport,
  options: SessionEngineOptions = {},
): Promise<SessionEngine> {
  let counter = 0
  const makeID = options.makeID ?? (() => `msg_${Date.now().toString(36)}_${++counter}`)
  const now = options.now ?? Date.now
  const reconnect = options.reconnect ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 100)))
  let state: EngineState = {
    folded: SessionFold.fromSnapshot(await transport.snapshot(sessionID)),
    outbox: [],
    overlay: new Map(),
    synced: false,
  }
  const listeners = new Set<(view: SessionView) => void>()
  const failureListeners = new Set<(failure: IntentFailure) => void>()
  const settled = new Set<() => void>()
  const ready = Promise.withResolvers<void>()
  let sent: string | undefined
  let stopped = false
  let sending = false
  let refreshing: Promise<void> | undefined
  const abort = new AbortController()

  const publish = (next: EngineState) => {
    const previous = state
    state = next
    // Views derive from folded/outbox/overlay only, so synced flips and stale
    // replays (where the fold returns its input) need no render or notify.
    if (next.folded !== previous.folded || next.outbox !== previous.outbox || next.overlay !== previous.overlay) {
      const view = render(state)
      listeners.forEach((listener) => listener(view))
    }
    if (state.outbox.length > 0) return
    settled.forEach((resolve) => resolve())
    settled.clear()
  }

  const applySnapshot = (snapshot: SessionSnapshot, synced = false) => {
    const folded = SessionFold.fromSnapshot(snapshot)
    const acknowledged = new Set([
      ...folded.messages.map((message) => message.id),
      ...folded.inbox.map((item) => item.id),
    ])
    publish({
      folded,
      outbox: state.outbox.filter((intent) => !acknowledged.has(intent.id)),
      overlay: new Map(),
      synced,
    })
  }

  const applyDurable = (event: DurableSessionEvent) => {
    if (event.type === "session.inbox.enqueued" && sent === event.data.inboxID) sent = undefined
    publish({
      folded: SessionFold.apply(state.folded, event),
      outbox:
        event.type === "session.inbox.enqueued"
          ? state.outbox.filter((intent) => intent.id !== event.data.inboxID)
          : state.outbox,
      overlay: clearOverlay(state.overlay, event),
      synced: state.synced,
    })
    send()
  }

  const reject = (intent: Intent, reason: string) => {
    publish({ ...state, outbox: state.outbox.filter((item) => item.id !== intent.id) })
    failureListeners.forEach((listener) => listener({ intent, reason }))
  }

  const send = () => {
    if (!state.synced || sending || stopped) return
    const intent = state.outbox[0]
    if (!intent || sent === intent.id) return
    sending = true
    sent = intent.id
    void (async () => {
      try {
        await transport.submit({ id: intent.id, sessionID, request: intent.request })
      } catch (error) {
        if (!(error instanceof SubmitRejected)) return
        sent = undefined
        reject(intent, error.reason)
      }
    })().finally(() => {
      sending = false
      send()
    })
  }

  const sync = async () => {
    while (!stopped) {
      try {
        for await (const item of transport.stream(sessionID, state.folded.seq, abort.signal)) {
          if (stopped) return
          if (item.type === "log.synced") {
            // A marker past the fold means the server skipped events it could not
            // replay for this cursor; recover through a fresh snapshot.
            if (item.seq !== undefined && item.seq > state.folded.seq) throw new SeqUnavailable()
            sent = undefined
            publish({ ...state, synced: true })
            ready.resolve()
            send()
            continue
          }
          if ("durable" in item) {
            applyDurable(item)
            continue
          }
          publish({ ...state, overlay: applyOverlay(state.overlay, item) })
        }
      } catch (error) {
        if (error instanceof SeqUnavailable) {
          try {
            applySnapshot(await transport.snapshot(sessionID))
          } catch {
            await reconnect()
          }
          continue
        }
      }
      if (stopped) return
      publish({ ...state, synced: false })
      await reconnect()
    }
  }

  void sync()

  return {
    sessionID,
    view: () => render(state),
    submit(input) {
      const intent: Intent = {
        id: input.id ?? makeID(),
        created: now(),
        request: input,
        item: {
          type: "user",
          delivery: input.delivery ?? "steer",
          payload: {
            text: input.text,
            agents: input.agents?.map((agent) => ({ ...agent })),
            metadata: input.metadata,
          },
        },
      }
      publish({ ...state, outbox: [...state.outbox, intent] })
      send()
      return intent
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeFailures(listener) {
      failureListeners.add(listener)
      return () => failureListeners.delete(listener)
    },
    ready: () => ready.promise,
    refresh() {
      if (refreshing) return refreshing
      refreshing = transport
        .snapshot(sessionID)
        .then((snapshot) => {
          if (snapshot.seq < state.folded.seq) return
          applySnapshot(snapshot, state.synced)
          send()
        })
        .finally(() => {
          refreshing = undefined
        })
      return refreshing
    },
    settled() {
      if (state.outbox.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => settled.add(resolve))
    },
    stop() {
      stopped = true
      abort.abort()
      publish({ ...state, synced: false })
    },
  }
}

// Render runs per ephemeral event, so everything an event did not touch must
// keep its reference: the adapter diffs consecutive views by identity to
// decide what to write into the reactive store. Both caches key on persistent
// inputs (a fold, outbox, or usage entry keeps its identity until it actually
// changes), so per-delta renders only reapply the overlay.
export function render(state: Pick<EngineState, "folded" | "outbox" | "overlay">): SessionView {
  const base = renderBase(state.folded, state.outbox)
  return {
    ...state.folded,
    session: usageSession(state.folded, state.overlay.get("usage")),
    messages: applyOverlayToMessages(base.messages, state.overlay),
    pending: base.pending,
  }
}

const bases = new WeakMap<SessionFoldState, ReturnType<typeof buildBase>>()

function renderBase(folded: SessionFoldState, outbox: EngineState["outbox"]) {
  const hit = bases.get(folded)
  if (hit && hit.outbox === outbox) return hit
  const base = buildBase(folded, outbox)
  bases.set(folded, base)
  return base
}

function buildBase(folded: SessionFoldState, outbox: EngineState["outbox"]) {
  const pending =
    outbox.length === 0
      ? folded.inbox
      : [
          ...folded.inbox,
          ...outbox.map(
            (intent): SessionInboxInfo => ({
              id: intent.id,
              sessionID: folded.session.id,
              timeCreated: intent.created,
              ...intent.item,
            }),
          ),
        ]
  const appended = pendingMessages(folded, pending)
  return {
    outbox,
    pending,
    messages: appended.length === 0 ? folded.messages : [...folded.messages, ...appended],
  }
}

function pendingMessages(folded: SessionFoldState, pending: ReadonlyArray<SessionInboxInfo>) {
  if (pending.length === 0) return []
  const messageIDs = new Set(folded.messages.map((message) => message.id))
  return pending.flatMap((item): ReadonlyArray<SessionMessageInfo> => {
    if (item.type !== "compaction" && item.delivery === "queue") return []
    if (messageIDs.has(item.id)) return []
    const message = SessionFold.messageFromInbox(item)
    return message ? [message] : []
  })
}

const usageSessions = new WeakMap<
  Extract<OverlayEntry, { type: "usage" }>,
  { base: SessionFoldState["session"]; session: SessionFoldState["session"] }
>()

function usageSession(folded: SessionFoldState, entry: OverlayEntry | undefined) {
  if (entry?.type !== "usage") return folded.session
  const hit = usageSessions.get(entry)
  if (hit && hit.base === folded.session) return hit.session
  const session = { ...folded.session, cost: entry.value.cost, tokens: entry.value.tokens }
  usageSessions.set(entry, { base: folded.session, session })
  return session
}

function applyOverlay(overlay: Overlay, event: EphemeralSessionEvent): Overlay {
  const next = new Map(overlay)
  switch (event.type) {
    case "session.text.delta": {
      const key = partKey("text", event.data.assistantMessageID, event.data.ordinal)
      const current = next.get(key)
      next.set(key, {
        type: "text",
        value: (current?.type === "text" ? current.value : "") + event.data.delta,
      })
      return next
    }
    case "session.reasoning.delta": {
      const key = partKey("reasoning", event.data.assistantMessageID, event.data.ordinal)
      const current = next.get(key)
      next.set(key, {
        type: "reasoning",
        value: (current?.type === "reasoning" ? current.value : "") + event.data.delta,
      })
      return next
    }
    case "session.tool.input.delta": {
      const key = toolKey("tool-input", event.data.assistantMessageID, event.data.id)
      const current = next.get(key)
      next.set(key, {
        type: "tool-input",
        value: (current?.type === "tool-input" ? current.value : "") + event.data.delta,
      })
      return next
    }
    case "session.tool.progress":
      next.set(toolKey("tool-progress", event.data.assistantMessageID, event.data.id), {
        type: "tool-progress",
        metadata: event.data.metadata,
      })
      return next
    case "session.compaction.delta": {
      const current = next.get("compaction")
      next.set("compaction", {
        type: "compaction",
        value: (current?.type === "compaction" ? current.value : "") + event.data.text,
      })
      return next
    }
    case "session.usage.updated":
      next.set("usage", { type: "usage", value: event.data })
      return next
  }
}

function clearOverlay(overlay: Overlay, event: DurableSessionEvent): Overlay {
  switch (event.type) {
    case "session.text.ended":
      return removeOverlay(overlay, partKey("text", event.data.assistantMessageID, event.data.ordinal))
    case "session.reasoning.ended":
      return removeOverlay(overlay, partKey("reasoning", event.data.assistantMessageID, event.data.ordinal))
    case "session.tool.input.ended":
    case "session.tool.called":
      return removeOverlay(overlay, toolKey("tool-input", event.data.assistantMessageID, event.data.id))
    case "session.tool.success":
    case "session.tool.failed":
      return removeOverlay(overlay, toolKey("tool-progress", event.data.assistantMessageID, event.data.id))
    case "session.compaction.ended":
    case "session.compaction.failed":
      return removeOverlay(overlay, "compaction")
    case "session.step.ended":
    case "session.step.failed":
    case "session.usage.recorded":
      return removeOverlay(overlay, "usage")
    default:
      return overlay
  }
}

function removeOverlay(overlay: Overlay, key: string): Overlay {
  if (!overlay.has(key)) return overlay
  const next = new Map(overlay)
  next.delete(key)
  return next
}

function applyOverlayToMessages(messages: ReadonlyArray<SessionMessageInfo>, overlay: Overlay) {
  if (overlay.size === 0) return messages
  // Remap only the messages the overlay actually touches so everything else
  // keeps its identity.
  const compacting = overlay.has("compaction")
  const touched = new Set<string>()
  overlay.forEach((_, key) => {
    const id = keyMessageID(key)
    if (id) touched.add(id)
  })
  if (touched.size === 0 && !compacting) return messages
  return messages.map((message): SessionMessageInfo => {
    if (message.type === "compaction" && message.status === "running") {
      if (!compacting) return message
      const entry = overlay.get("compaction")
      return entry?.type === "compaction" ? { ...message, summary: message.summary + entry.value } : message
    }
    if (message.type !== "assistant" || !touched.has(message.id)) return message
    const ordinals = { text: 0, reasoning: 0 }
    const content = message.content.map((part) => {
      if (part.type === "text") {
        const entry = overlay.get(partKey("text", message.id, ordinals.text++))
        return entry?.type === "text" ? { ...part, text: part.text + entry.value } : part
      }
      if (part.type === "reasoning") {
        const entry = overlay.get(partKey("reasoning", message.id, ordinals.reasoning++))
        return entry?.type === "reasoning" ? { ...part, text: part.text + entry.value } : part
      }
      const input = overlay.get(toolKey("tool-input", message.id, part.id))
      if (input?.type === "tool-input" && part.state.status === "streaming")
        return { ...part, state: { ...part.state, input: part.state.input + input.value } }
      const progress = overlay.get(toolKey("tool-progress", message.id, part.id))
      if (progress?.type === "tool-progress" && part.state.status === "running")
        return { ...part, state: { ...part.state, metadata: progress.metadata } }
      return part
    })
    return content.some((part, index) => part !== message.content[index]) ? { ...message, content } : message
  })
}

function partKey(type: "text" | "reasoning", messageID: string, ordinal: number) {
  return `${type}:${messageID}:${ordinal}`
}

function toolKey(type: "tool-input" | "tool-progress", messageID: string, toolID: string) {
  return `${type}:${messageID}:${toolID}`
}

// Second segment of a part or tool key; undefined for the segmentless
// "compaction" and "usage" keys.
function keyMessageID(key: string) {
  return key.split(":")[1]
}

export * as Engine from "./engine"
