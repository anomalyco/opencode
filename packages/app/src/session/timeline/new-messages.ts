import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "@opencode/session-ui/timeline/projection"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createComputed, createMemo, on, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { ServerScope } from "@/runtime/server/scope"

const cursorSchema = Schema.Struct({
  messageID: Schema.String,
  created: Schema.Number,
  partID: Schema.optional(Schema.String),
})

type Cursor = typeof cursorSchema.Type

const emptyParts: ReadonlySet<string> = new Set()

export function unseenTimelineParts(messages: SessionMessageInfo[], cursor: Cursor | null) {
  if (!cursor) return emptyParts
  const seen = messages.findIndex((message) => message.id === cursor.messageID)

  return new Set(
    messages.flatMap((message, index) => {
      if (message.type !== "assistant" || index < seen) return []
      const parts = Timeline.contentEntries(message)

      if (seen < 0) return message.time.created > cursor.created ? parts.map((part) => part.id) : []

      if (index > seen) return parts.map((part) => part.id)
      const part = parts.findIndex((part) => part.id === cursor.partID)

      if (cursor.partID && part < 0) return []

      return parts.slice(part + 1).map((part) => part.id)
    }),
  )
}

export function createNewMessages(input: {
  scope: ServerScope
  directory: string
  sessionID: string
  messages: Accessor<SessionMessageInfo[]>
  active: Accessor<boolean>
  enabled: Accessor<boolean>
  caughtUp: Accessor<boolean>
  pendingInputIDs: Accessor<ReadonlySet<string>>
}) {
  const [saved, setSaved, , ready] = persisted(
    Persist.serverSession(input.scope, input.directory, input.sessionID, "timeline-seen"),
    Persistence.struct({ cursor: Schema.NullOr(cursorSchema) }),
    { cursor: null },
  )

  const [state, setState] = createStore<{
    focused: boolean
    phase: "idle" | "unread" | "read"
    retained: ReadonlySet<string>
    baseline: Cursor | null
  }>({
    focused: document.hasFocus() && document.visibilityState !== "hidden",
    phase: "idle",
    retained: emptyParts,
    baseline: null,
  })

  const focus = () => setState("focused", document.hasFocus() && document.visibilityState !== "hidden")
  makeEventListener(window, "focus", focus)
  makeEventListener(window, "blur", focus)
  makeEventListener(document, "visibilitychange", focus)

  // Cached rows can render before the selected transcript finishes refreshing.
  const watching = createMemo(() => input.active() && state.focused && ready() && input.caughtUp())

  // Pending steers are displayed after live work, not at its read boundary.
  const messages = createMemo(() => {
    const pending = input.pendingInputIDs()

    return pending.size ? input.messages().filter((message) => !pending.has(message.id)) : input.messages()
  })

  const unseen = createMemo(() =>
    watching() && state.phase === "unread" ? unseenTimelineParts(messages(), state.baseline) : emptyParts,
  )

  createComputed(() => {
    const parts = unseen()

    if (parts.size) setState("retained", parts)
  })

  const read = () => {
    if (!watching()) return
    const message = messages().at(-1)

    if (!message) return
    const partID = message.type === "assistant" ? Timeline.contentEntries(message).at(-1)?.id : undefined

    setState("phase", "read")

    if (saved.cursor?.messageID !== message.id || saved.cursor?.partID !== partID)
      setSaved("cursor", { messageID: message.id, created: message.time.created, partID })
  }

  createComputed(
    on(watching, (watching) => {
      if (!watching) return

      setState({
        baseline: saved.cursor ? { ...saved.cursor } : null,
        phase: saved.cursor ? "unread" : "idle",
        retained: emptyParts,
      })

      if (unseen().size === 0) read()
    }),
  )

  createComputed(() => {
    if (watching() && !input.enabled()) untrack(read)
  })

  return {
    parts: createMemo(() => {
      if (!watching()) return emptyParts

      if (state.phase === "read") return state.retained

      return input.enabled() ? unseen() : emptyParts
    }),
    dismissed: () => state.phase === "read",
    read,
    release: () => setState("retained", emptyParts),
  }
}
