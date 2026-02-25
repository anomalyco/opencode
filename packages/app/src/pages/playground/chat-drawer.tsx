import { createSignal, For, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { usePlayground } from "@/context/playground"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export function ChatDrawer() {
  const playground = usePlayground()
  const [messages] = createSignal<ChatMessage[]>([])

  const title = () => {
    const sel = playground.selected
    return sel ? `Chat — ${sel.title}` : "Chat"
  }

  return (
    <div
      data-component="playground-chat-drawer"
      class="w-80 shrink-0 border-l border-border-base bg-background-base flex flex-col overflow-hidden"
    >
      <div class="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border-base">
        <span class="text-12-medium text-text-base truncate">{title()}</span>
        <IconButton icon="close" variant="ghost" class="w-5 h-5" onClick={() => playground.setPanel("none")} />
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <Show
          when={messages().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-text-dimmed-base text-12-regular">No messages yet. Start by sending a prompt.</p>
            </div>
          }
        >
          <div class="flex flex-col gap-3">
            <For each={messages()}>
              {(msg) => (
                <div
                  class="rounded-md px-3 py-2 text-12-regular"
                  classList={{
                    "bg-background-stronger text-text-base": msg.role === "user",
                    "text-text-dimmed-base": msg.role === "assistant",
                  }}
                >
                  <p class="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
