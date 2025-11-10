import type { Component } from "solid-js"
import { Show, For, createEffect, createSignal } from "solid-js"
import type { Message, Part } from "@opencode-ai/sdk/client"
import { useSync } from "../context/sync"
import { MessageBubble } from "./message-bubble"

interface MessageListProps {
  sessionID: string
}

export const MessageList: Component<MessageListProps> = (props) => {
  const sync = useSync()
  const [autoScroll, setAutoScroll] = createSignal(true)
  let messagesEndRef: HTMLDivElement | undefined

  const messages = () => sync.data.message[props.sessionID] ?? []
  const getMessageParts = (messageID: string): Part[] => sync.data.part[messageID] ?? []

  createEffect(() => {
    if (autoScroll() && messagesEndRef) {
      setTimeout(() => {
        messagesEndRef?.scrollIntoView({ behavior: "smooth" })
      }, 0)
    }
  })

  const handleScroll = (e: Event) => {
    const container = e.target as HTMLDivElement
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
    setAutoScroll(isAtBottom)
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background: "#1a1a1a",
        padding: "1rem 0",
      }}
      onScroll={handleScroll}
    >
      <Show when={messages().length === 0}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            height: "100%",
            color: "#6a6a6a",
            "font-size": "0.9rem",
          }}
        >
          No messages yet
        </div>
      </Show>

      <For each={messages()}>
        {(message) => {
          const parts = getMessageParts(message.id)
          return <MessageBubble message={message} parts={parts} />
        }}
      </For>

      <div ref={messagesEndRef} />
    </div>
  )
}
