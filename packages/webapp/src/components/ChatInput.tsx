import { createSignal, Show } from "solid-js"
import { sendMessage, isSendingMessage, currentSessionID } from "../stores/session"

export function ChatInput() {
  const [input, setInput] = createSignal("")
  const [isComposing, setIsComposing] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()

    const message = input().trim()
    if (!message || isSendingMessage() || !currentSessionID()) return

    // Clear input immediately for better UX
    setInput("")

    try {
      await sendMessage(message)
    } catch (error) {
      console.error("Failed to send message:", error)
      // Restore input on error
      setInput(message)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey && !isComposing()) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setInput(target.value)

    // Auto-resize textarea
    target.style.height = "auto"
    target.style.height = target.scrollHeight + "px"
  }

  return (
    <div class="border-t border-gray-800 bg-gray-900 p-4">
      <form onSubmit={handleSubmit} class="max-w-4xl mx-auto">
        <div class="flex gap-2 items-end">
          {/* Textarea */}
          <div class="flex-1 relative">
            <textarea
              value={input()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder={
                currentSessionID()
                  ? "Type your message... (Enter to send, Shift+Enter for new line)"
                  : "Select a session to start chatting"
              }
              disabled={!currentSessionID() || isSendingMessage()}
              class="
                w-full px-4 py-3 pr-12
                bg-gray-800 border border-gray-700 rounded-lg
                text-gray-100 placeholder-gray-500
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                resize-none overflow-hidden
                disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[52px] max-h-[200px]
              "
              rows="1"
            />

            {/* Character count */}
            <Show when={input().length > 0}>
              <div class="absolute bottom-2 right-2 text-xs text-gray-500">
                {input().length}
              </div>
            </Show>
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!input().trim() || isSendingMessage() || !currentSessionID()}
            class="
              btn btn-primary
              h-[52px] px-6
              flex items-center gap-2
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            <Show
              when={!isSendingMessage()}
              fallback={
                <>
                  <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Sending...</span>
                </>
              }
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
              <span>Send</span>
            </Show>
          </button>
        </div>

        {/* Hints */}
        <div class="mt-2 flex items-center justify-between text-xs text-gray-500">
          <div class="flex items-center gap-4">
            <span>Press Enter to send</span>
            <span>•</span>
            <span>Shift + Enter for new line</span>
          </div>

          <Show when={isSendingMessage()}>
            <div class="flex items-center gap-2 text-primary-400">
              <div class="w-2 h-2 bg-primary-400 rounded-full animate-pulse" />
              <span>AI is typing...</span>
            </div>
          </Show>
        </div>
      </form>
    </div>
  )
}
