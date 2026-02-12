import { AssistantMessage, Message as MessageType, Part as PartType } from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"

import { Binary } from "@opencode-ai/util/binary"
import { createMemo, For, ParentProps, Show } from "solid-js"
import { Message } from "./message-part"
import { Card } from "./card"
import { Spinner } from "./spinner"
import { createAutoScroll } from "../hooks"

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)

  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }

  if (!record(json)) return message

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return message
}

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function visible(part: PartType) {
  if (part.type === "tool") return true
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return !!part.text?.trim()
  return false
}

function AssistantMessageItem(props: { message: AssistantMessage; showAssistantCopyPartID?: string }) {
  const data = useData()
  const emptyParts: PartType[] = []
  const msgParts = createMemo(() => list(data.store.part?.[props.message.id], emptyParts))
  return <Message message={props.message} parts={msgParts()} showAssistantCopyPartID={props.showAssistantCopyPartID} />
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    lastUserMessageID?: string
    onUserInteracted?: () => void
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => list(data.store.message?.[props.sessionID], emptyMessages))

  const messageIndex = createMemo(() => {
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, props.messageID, (m) => m.id)

    const index = result.found ? result.index : messages.findIndex((m) => m.id === props.messageID)
    if (index < 0) return -1

    const msg = messages[index]
    if (!msg || msg.role !== "user") return -1

    return index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const messages = allMessages() ?? emptyMessages
    const msg = messages[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const lastUserMessageID = createMemo(() => {
    if (props.lastUserMessageID) return props.lastUserMessageID

    const messages = allMessages() ?? emptyMessages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role === "user") return msg.id
    }
    return undefined
  })

  const isLastUserMessage = createMemo(() => props.messageID === lastUserMessageID())

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return list(data.store.part?.[msg.id], emptyParts)
  })

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages() ?? emptyMessages
      const index = messageIndex()
      if (index < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = index + 1; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "user") break
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: same },
  )

  const error = createMemo(() => assistantMessages().find((m) => m.error)?.error)
  const showAssistantCopyPartID = createMemo(() => {
    const messages = assistantMessages()

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = list(data.store.part?.[message.id], emptyParts)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }

    return undefined
  })
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    return unwrap(String(msg))
  })

  const status = createMemo(() => data.store.session_status[props.sessionID] ?? idle)
  const working = createMemo(() => status().type !== "idle" && isLastUserMessage())
  const assistantVisible = createMemo(() =>
    assistantMessages().reduce((count, message) => {
      const parts = list(data.store.part?.[message.id], emptyParts)
      return count + parts.filter(visible).length
    }, 0),
  )

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "dynamic",
  })

  return (
    <div data-component="session-turn" class={props.classes?.root}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        class={props.classes?.content}
      >
        <div onClick={autoScroll.handleInteraction}>
          <Show when={message()}>
            {(msg) => (
              <div
                ref={autoScroll.contentRef}
                data-message={msg().id}
                data-slot="session-turn-message-container"
                class={props.classes?.container}
              >
                <div data-slot="session-turn-message-content" aria-live="off">
                  <Message message={msg()} parts={parts()} />
                </div>
                <Show when={working() && assistantVisible() === 0 && !error()}>
                  <div data-slot="session-turn-thinking">
                    <span>Thinking</span>
                    <Spinner style={{ width: "16px" }} />
                  </div>
                </Show>
                <Show when={assistantMessages().length > 0}>
                  <div data-slot="session-turn-assistant-content" aria-hidden={working()}>
                    <For each={assistantMessages()}>
                      {(assistantMessage) => (
                        <AssistantMessageItem
                          message={assistantMessage}
                          showAssistantCopyPartID={showAssistantCopyPartID()}
                        />
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={error()}>
                  <Card variant="error" class="error-card">
                    {errorText()}
                  </Card>
                </Show>
              </div>
            )}
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
