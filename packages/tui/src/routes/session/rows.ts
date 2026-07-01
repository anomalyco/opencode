import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { createEffect, on, onCleanup, type Accessor } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useData } from "../../context/data"

export type PartRef = {
  messageID: string
  partID: string
}

export type SessionRow =
  | { type: "message"; messageID: string }
  | { type: "part"; ref: PartRef }
  | {
      type: "group"
      kind: "exploration"
      refs: PartRef[]
      pending: PartRef[]
      completed: boolean
    }
  | { type: "assistant-footer"; messageID: string }

export function createSessionRows(sessionID: Accessor<string>) {
  const data = useData()
  const [rows, setRows] = createStore<SessionRow[]>([])
  const revertBoundary = () => data.session.get(sessionID())?.revert?.messageID

  function reduce() {
    const messages = data.session.message.list(sessionID())
    const boundary = revertBoundary()
    return reduceSessionRows(boundary ? messages.filter((message) => message.id < boundary) : messages)
  }

  createEffect(() => {
    const pending = new Set(
      (data.session.permission.list(sessionID()) ?? []).flatMap((request) =>
        request.source?.type === "tool" ? [request.source.callID] : [],
      ),
    )
    setRows(
      produce((draft) => {
        draft.forEach((row) => {
          if (row.type !== "group") return
          const refs = [...row.refs, ...row.pending]
          row.refs = refs.filter((ref) => !pending.has(ref.partID))
          row.pending = refs.filter((ref) => pending.has(ref.partID))
        })
      }),
    )
  })

  createEffect(
    on(sessionID, (id) => {
      setRows(reconcile(reduce()))
      void data.session.message.refresh(id).then(
        () => {
          if (sessionID() !== id) return
          setRows(reconcile(reduce()))
        },
        () => undefined,
      )
    }),
  )

  // Re-reduce when the revert boundary changes (stage/clear/commit).
  createEffect(
    on(revertBoundary, () => {
      setRows(reconcile(reduce()))
    }),
  )

  const appendMessage = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "message" && row.messageID === messageID)) return
        completePrevious(draft)
        draft.push({ type: "message", messageID })
      }),
    )

  const appendPart = (ref: PartRef, name?: string) =>
    setRows(
      produce((draft) => {
        if (hasPart(draft, ref)) return
        if (name && exploration(name)) {
          const previous = draft.at(-1)
          if (previous?.type === "group" && previous.kind === "exploration") {
            previous.refs.push(ref)
            return
          }
          completePrevious(draft)
          draft.push({
            type: "group",
            kind: "exploration",
            refs: [ref],
            pending: [],
            completed: false,
          })
          return
        }
        completePrevious(draft)
        draft.push({ type: "part", ref })
      }),
    )

  const appendFooter = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "assistant-footer" && row.messageID === messageID)) return
        completePrevious(draft)
        draft.push({ type: "assistant-footer", messageID })
      }),
    )

  const message = (event: { data: { sessionID: string; messageID: string } }) => {
    if (event.data.sessionID === sessionID()) appendMessage(event.data.messageID)
  }
  const subscriptions = [
    data.on("session.next.prompt.admitted", message),
    data.on("session.next.prompted", message),
    data.on("session.next.context.updated", message),
    data.on("session.next.synthetic", message),
    data.on("session.next.shell.started", message),
    data.on("session.next.agent.switched", message),
    data.on("session.next.model.switched", message),
    data.on("session.next.compaction.ended", message),
    data.on("session.next.text.delta", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.textID })
    }),
    data.on("session.next.text.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.textID })
    }),
    data.on("session.next.reasoning.delta", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.reasoningID })
    }),
    data.on("session.next.reasoning.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.reasoningID })
    }),
    data.on("session.next.tool.input.started", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.callID }, event.data.name)
    }),
    data.on("session.next.step.ended", (event) => {
      if (event.data.sessionID !== sessionID() || ["tool-calls", "unknown"].includes(event.data.finish)) return
      appendFooter(event.data.assistantMessageID)
    }),
    data.on("session.next.step.failed", (event) => {
      if (event.data.sessionID === sessionID()) appendFooter(event.data.assistantMessageID)
    }),
  ]
  onCleanup(() => subscriptions.forEach((unsubscribe) => unsubscribe()))

  return rows
}

export function reduceSessionRows(messages: SessionMessage[]) {
  return messages.reduce<SessionRow[]>((rows, message) => {
    if (message.type !== "assistant") {
      completePrevious(rows)
      rows.push({ type: "message", messageID: message.id })
      return rows
    }
    message.content.forEach((part) => {
      if ((part.type === "text" || part.type === "reasoning") && !part.text.trim()) return
      append(rows, { messageID: message.id, partID: part.id }, part)
    })
    if ((message.finish && !["tool-calls", "unknown"].includes(message.finish)) || message.error) {
      completePrevious(rows)
      rows.push({ type: "assistant-footer", messageID: message.id })
    }
    return rows
  }, [])
}

function append(rows: SessionRow[], ref: PartRef, part: SessionMessageAssistant["content"][number]) {
  if (part.type === "tool") {
    if (exploration(part.name)) {
      const previous = rows.at(-1)
      if (previous?.type === "group" && previous.kind === "exploration") {
        previous.refs.push(ref)
        return
      }
      completePrevious(rows)
      rows.push({ type: "group", kind: "exploration", refs: [ref], pending: [], completed: false })
      return
    }
  }
  completePrevious(rows)
  rows.push({ type: "part", ref })
}

function completePrevious(rows: SessionRow[]) {
  const previous = rows.at(-1)
  if (previous?.type === "group") previous.completed = true
}

function exploration(name: string) {
  return ["read", "glob", "grep"].includes(name.toLowerCase())
}

function hasPart(rows: SessionRow[], ref: PartRef) {
  return rows.some((row) => {
    if (row.type === "part") return row.ref.messageID === ref.messageID && row.ref.partID === ref.partID
    if (row.type !== "group") return false
    return [...row.refs, ...row.pending].some(
      (item) => item.messageID === ref.messageID && item.partID === ref.partID,
    )
  })
}
