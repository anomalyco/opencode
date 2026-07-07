import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/sdk/v2"
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
    const inputs = new Set(data.session.input.list(sessionID()))
    const boundary = revertBoundary()
    const rows = reduceSessionRows(boundary ? messages.filter((message) => message.id < boundary) : messages, inputs)
    partitionPending(rows, pendingPermissions())
    return rows
  }

  function pendingPermissions() {
    return new Set(
      (data.session.permission.list(sessionID()) ?? []).flatMap((request) =>
        request.source?.type === "tool" ? [request.source.callID] : [],
      ),
    )
  }

  createEffect(() => {
    const pending = pendingPermissions()
    setRows(
      produce((draft) => {
        partitionPending(draft, pending)
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

  createEffect(
    on(
      () =>
        data.session.message.list(sessionID()).flatMap((message) =>
          message.type === "user"
            ? [
                {
                  id: message.id,
                  created: message.time.created,
                  input: data.session.input.has(sessionID(), message.id),
                },
              ]
            : message.type === "compaction"
              ? [
                  {
                    id: message.id,
                    created: message.time.created,
                    input: message.status === "running",
                  },
                ]
              : [],
        ),
      () => setRows(reconcile(reduce())),
    ),
  )

  const appendMessage = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "message" && row.messageID === messageID)) return
        const pending = isPending(messageID)
        const message = data.session.message.get(sessionID(), messageID)
        const index =
          message?.type === "compaction" && pending ? queuedStart(draft) : pending ? draft.length : queuedStart(draft)
        if (!pending) completePrevious(draft, index)
        draft.splice(index, 0, { type: "message", messageID })
      }),
    )

  const appendPart = (ref: PartRef, name?: string) =>
    setRows(
      produce((draft) => {
        if (hasPart(draft, ref)) return
        const index = queuedStart(draft)
        if (name && exploration(name)) {
          const previous = draft[index - 1]
          if (previous?.type === "group" && previous.kind === "exploration") {
            previous.refs.push(ref)
            return
          }
          completePrevious(draft, index)
          draft.splice(index, 0, {
            type: "group",
            kind: "exploration",
            refs: [ref],
            pending: [],
            completed: false,
          })
          return
        }
        completePrevious(draft, index)
        draft.splice(index, 0, { type: "part", ref })
      }),
    )

  const appendFooter = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "assistant-footer" && row.messageID === messageID)) return
        const index = queuedStart(draft)
        completePrevious(draft, index)
        draft.splice(index, 0, { type: "assistant-footer", messageID })
      }),
    )

  const removeFooter = (messageID: string) =>
    setRows(
      produce((draft) => {
        const index = draft.findIndex((row) => row.type === "assistant-footer" && row.messageID === messageID)
        if (index !== -1) draft.splice(index, 1)
      }),
    )

  const isPending = (messageID: string) => {
    const message = data.session.message.get(sessionID(), messageID)
    if (message?.type === "user") return data.session.input.has(sessionID(), messageID)
    return message?.type === "compaction" && message.status === "running"
  }

  const queuedStart = (rows: SessionRow[]) => {
    const index = rows.findIndex((row) => row.type === "message" && isPending(row.messageID))
    return index === -1 ? rows.length : index
  }

  const message = (event: { id: string; data: { sessionID: string } }) => {
    if (event.data.sessionID === sessionID()) appendMessage(event.id.replace(/^evt_/, "msg_"))
  }
  const input = (event: { data: { sessionID: string; inputID: string } }) => {
    if (event.data.sessionID === sessionID()) appendMessage(event.data.inputID)
  }
  const subscriptions = [
    data.on("session.prompt.admitted", input),
    data.on("session.compaction.started", message),
    data.on("session.instructions.updated", message),
    data.on("session.synthetic", (event) => {
      if (event.data.sessionID === sessionID() && event.data.description?.trim())
        appendMessage(event.id.replace(/^evt_/, "msg_"))
    }),
    data.on("session.shell.started", message),
    data.on("session.agent.selected", message),
    data.on("session.model.selected", message),
    data.on("session.compaction.ended", (event) => {
      if (event.data.reason !== "manual") message(event)
    }),
    data.on("session.text.delta", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: `text:${event.data.ordinal}` })
    }),
    data.on("session.text.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: `text:${event.data.ordinal}` })
    }),
    data.on("session.reasoning.delta", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: `reasoning:${event.data.ordinal}` })
    }),
    data.on("session.reasoning.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: `reasoning:${event.data.ordinal}` })
    }),
    data.on("session.tool.input.started", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart({ messageID: event.data.assistantMessageID, partID: event.data.callID }, event.data.name)
    }),
    data.on("session.retry.scheduled", (event) => {
      if (event.data.sessionID === sessionID()) appendFooter(event.data.assistantMessageID)
    }),
    data.on("session.step.started", (event) => {
      if (event.data.sessionID === sessionID()) removeFooter(event.data.assistantMessageID)
    }),
    data.on("session.step.ended", (event) => {
      if (event.data.sessionID !== sessionID() || ["tool-calls", "unknown"].includes(event.data.finish)) return
      appendFooter(event.data.assistantMessageID)
    }),
    data.on("session.step.failed", (event) => {
      if (event.data.sessionID === sessionID()) appendFooter(event.data.assistantMessageID)
    }),
  ]
  onCleanup(() => subscriptions.forEach((unsubscribe) => unsubscribe()))

  return rows
}

export function reduceSessionRows(messages: SessionMessageInfo[], inputs = new Set<string>()) {
  const isInput = (message: SessionMessageInfo) => inputs.has(message.id)
  const pendingCompactions = messages.filter((message) => message.type === "compaction" && message.status === "running")
  const pending = new Set([...pendingCompactions.map((message) => message.id), ...inputs])
  return [
    ...messages.filter((message) => !pending.has(message.id)),
    ...pendingCompactions,
    ...messages.filter(isInput),
  ].reduce<SessionRow[]>((rows, message) => {
    if (message.type !== "assistant") {
      if (message.type === "synthetic" && !message.description?.trim()) return rows
      if (!pending.has(message.id)) completePrevious(rows)
      rows.push({ type: "message", messageID: message.id })
      return rows
    }
    const ordinals = { text: 0, reasoning: 0 }
    message.content.forEach((part) => {
      const partID = part.type === "tool" ? part.id : `${part.type}:${ordinals[part.type]++}`
      if ((part.type === "text" || part.type === "reasoning") && !part.text.trim()) return
      append(rows, { messageID: message.id, partID }, part)
    })
    if ((message.finish && !["tool-calls", "unknown"].includes(message.finish)) || message.error || message.retry) {
      completePrevious(rows)
      rows.push({ type: "assistant-footer", messageID: message.id })
    }
    return rows
  }, [])
}

export function resolvePart(message: SessionMessageAssistant, partID: string) {
  const tool = message.content.find((part) => part.type === "tool" && part.id === partID)
  if (tool) return tool
  const match = /^(text|reasoning):(\d+)$/.exec(partID)
  if (!match) return
  const ordinal = Number(match[2])
  return message.content.filter((part) => part.type === match[1])[ordinal]
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

function completePrevious(rows: SessionRow[], index = rows.length) {
  const previous = rows[index - 1]
  if (previous?.type === "group") previous.completed = true
}

function partitionPending(rows: SessionRow[], pending: Set<string>) {
  rows.forEach((row) => {
    if (row.type !== "group") return
    const refs = [...row.refs, ...row.pending]
    row.refs = refs.filter((ref) => !pending.has(ref.partID))
    row.pending = refs.filter((ref) => pending.has(ref.partID))
  })
}

function exploration(name: string) {
  return ["read", "glob", "grep"].includes(name.toLowerCase())
}

function hasPart(rows: SessionRow[], ref: PartRef) {
  return rows.some((row) => {
    if (row.type === "part") return row.ref.messageID === ref.messageID && row.ref.partID === ref.partID
    if (row.type !== "group") return false
    return [...row.refs, ...row.pending].some((item) => item.messageID === ref.messageID && item.partID === ref.partID)
  })
}
