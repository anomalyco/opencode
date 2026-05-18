/**
 * Role-aware prompt input for Collab Sessions.
 *
 * Driver:      full input, submits directly to LLM queue
 * Contributor: input labeled "Suggest a prompt", creates pending suggestion
 * Viewer:      no input shown
 */

import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import type { CollabRole } from "@opencode-ai/collab"

export function CollabPromptInput() {
  const collab = useCollab()
  const [value, setValue] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const callerRole = (): CollabRole => {
    const session = collab.session()
    if (!session) return "viewer"
    // Simplified: first driver is caller. In production read from auth cookie.
    return session.participants[0]?.role ?? "viewer"
  }

  const isDriver = () => callerRole() === "driver"
  const isContributor = () => callerRole() === "contributor"

  async function handleSubmit(e: Event) {
    e.preventDefault()
    const text = value().trim()
    if (!text) return
    setSending(true)
    try {
      if (isDriver()) {
        await collab.submitPrompt(text)
      } else if (isContributor()) {
        await collab.suggestPrompt(text)
      }
      setValue("")
    } finally {
      setSending(false)
    }
  }

  function handleTyping(text: string) {
    setValue(text)
    const session = collab.session()
    if (!session) return
    // Emit typing events based on visibility mode
    if (session.visibilityMode !== "submitted" && text.length > 0) {
      // In a real impl this would post to a typing endpoint
      // For now the SSE broadcast handles this via the collab:keystroke event
    }
  }

  return (
    <Show when={callerRole() !== "viewer"}>
      <form onSubmit={handleSubmit} class="flex gap-2">
        <div class="flex-1 relative">
          <textarea
            value={value()}
            onInput={(e) => handleTyping(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
            placeholder={
              isDriver()
                ? "Enter a prompt… (⏎ to send)"
                : "Suggest a prompt for Driver approval… (⏎ to send)"
            }
            class={`w-full bg-zinc-900 border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none transition-colors ${
              isDriver()
                ? "border-zinc-700 focus:border-blue-500"
                : "border-yellow-800/50 focus:border-yellow-600"
            }`}
            rows={2}
            disabled={sending()}
          />
          <Show when={!isDriver()}>
            <div class="absolute right-2 top-2 text-xs text-yellow-600 font-medium">Suggestion</div>
          </Show>
        </div>

        <button
          type="submit"
          disabled={sending() || !value().trim()}
          class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors self-end ${
            isDriver()
              ? "bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white"
              : "bg-yellow-700 hover:bg-yellow-600 disabled:bg-zinc-700 text-zinc-100"
          } disabled:text-zinc-500`}
        >
          {sending() ? "…" : isDriver() ? "Send" : "Suggest"}
        </button>
      </form>
    </Show>
  )
}
