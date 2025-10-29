import { For, Show, createEffect, onMount } from "solid-js"
import { messages, isLoadingMessages, currentSessionID } from "../stores/session"
import type { Message, MessagePart } from "../types"

export function MessageView() {
  let messagesEndRef: HTMLDivElement | undefined

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    if (messages().length > 0) {
      messagesEndRef?.scrollIntoView({ behavior: "smooth" })
    }
  })

  return (
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <Show
        when={!isLoadingMessages()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center text-gray-500">
              <div class="animate-spin inline-block w-8 h-8 border-2 border-gray-600 border-t-primary-500 rounded-full" />
              <p class="mt-2">Loading messages...</p>
            </div>
          </div>
        }
      >
        <Show
          when={messages().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-center text-gray-500">
                <svg
                  class="w-16 h-16 mx-auto mb-4 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
                <p class="text-lg">No messages yet</p>
                <p class="text-sm mt-1">Start a conversation by typing a message below</p>
              </div>
            </div>
          }
        >
          <For each={messages()}>
            {(message) => <MessageBubble message={message} />}
          </For>
          <div ref={messagesEndRef} />
        </Show>
      </Show>
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
}

function MessageBubble(props: MessageBubbleProps) {
  const isUser = () => props.message.role === "user"
  const isAssistant = () => props.message.role === "assistant"

  return (
    <div
      class={`
        flex gap-3
        ${isUser() ? "justify-end" : "justify-start"}
      `}
    >
      {/* Avatar */}
      <Show when={isAssistant()}>
        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-medium">
          AI
        </div>
      </Show>

      {/* Message Content */}
      <div
        class={`
          max-w-[80%] rounded-lg p-4
          ${
            isUser()
              ? "bg-primary-600 text-white"
              : "bg-gray-800 text-gray-100 border border-gray-700"
          }
        `}
      >
        <div class="space-y-2">
          <For each={props.message.parts}>
            {(part) => <MessagePartRenderer part={part} />}
          </For>
        </div>

        {/* Timestamp */}
        <div
          class={`
            text-xs mt-2 opacity-60
            ${isUser() ? "text-right" : "text-left"}
          `}
        >
          {new Date(props.message.time.created).toLocaleTimeString()}
        </div>
      </div>

      {/* User Avatar */}
      <Show when={isUser()}>
        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
          U
        </div>
      </Show>
    </div>
  )
}

interface MessagePartRendererProps {
  part: MessagePart
}

function MessagePartRenderer(props: MessagePartRendererProps) {
  return (
    <Show
      when={props.part.type === "text"}
      fallback={
        <Show
          when={props.part.type === "tool_call"}
          fallback={
            <Show
              when={props.part.type === "tool_result"}
              fallback={
                <Show
                  when={props.part.type === "thinking"}
                  fallback={
                    <div class="text-sm opacity-60">
                      <em>Unknown part type: {props.part.type}</em>
                    </div>
                  }
                >
                  <ThinkingPart part={props.part} />
                </Show>
              }
            >
              <ToolResultPart part={props.part} />
            </Show>
          }
        >
          <ToolCallPart part={props.part} />
        </Show>
      }
    >
      <TextPart part={props.part} />
    </Show>
  )
}

function TextPart(props: { part: MessagePart }) {
  return (
    <div class="prose prose-invert max-w-none">
      <div class="whitespace-pre-wrap break-words">{props.part.text}</div>
    </div>
  )
}

function ToolCallPart(props: { part: MessagePart }) {
  return (
    <div class="bg-gray-900/50 border border-gray-700 rounded p-3 text-sm">
      <div class="flex items-center gap-2 mb-2">
        <svg
          class="w-4 h-4 text-primary-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span class="font-medium text-primary-400">
          Tool: {props.part.tool?.name || "Unknown"}
        </span>
      </div>
      <Show when={props.part.tool?.parameters}>
        <pre class="text-xs text-gray-400 overflow-x-auto">
          {JSON.stringify(props.part.tool?.parameters, null, 2)}
        </pre>
      </Show>
    </div>
  )
}

function ToolResultPart(props: { part: MessagePart }) {
  return (
    <div class="bg-gray-900/30 border border-gray-700 rounded p-3 text-sm">
      <div class="flex items-center gap-2 mb-2">
        <svg
          class="w-4 h-4 text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span class="font-medium text-green-400">Tool Result</span>
      </div>
      <Show
        when={typeof props.part.result === "string"}
        fallback={
          <pre class="text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(props.part.result, null, 2)}
          </pre>
        }
      >
        <div class="text-gray-300 whitespace-pre-wrap">{props.part.result as string}</div>
      </Show>
    </div>
  )
}

function ThinkingPart(props: { part: MessagePart }) {
  return (
    <div class="bg-purple-900/20 border border-purple-700/50 rounded p-3 text-sm">
      <div class="flex items-center gap-2 mb-2">
        <svg
          class="w-4 h-4 text-purple-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <span class="font-medium text-purple-400">Thinking</span>
      </div>
      <div class="text-gray-300 italic whitespace-pre-wrap">{props.part.text}</div>
    </div>
  )
}
