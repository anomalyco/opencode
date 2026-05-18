/**
 * PromptQueuePanel — shows the queue in FIFO mode or the vote pool in Vote Pool mode.
 * Adapts based on session.queueMode.
 */

import { For, Show, createSignal } from "solid-js"
import { useCollab } from "@/context/collab"
import type { PromptSuggestion } from "@opencode-ai/collab"

function FifoQueue() {
  const collab = useCollab()

  return (
    <div class="p-2 space-y-1">
      <div class="text-xs font-medium text-zinc-500 uppercase tracking-wider px-1 mb-2">
        Prompt Queue
      </div>
      <Show when={collab.queue().length === 0}>
        <div class="text-xs text-zinc-600 px-1">No pending prompts</div>
      </Show>
      <For each={collab.queue()}>
        {(suggestion, idx) => (
          <div class="bg-zinc-800 rounded-md p-2 text-xs">
            <div class="flex items-start gap-2">
              <span class="text-zinc-500 font-mono">{idx() + 1}.</span>
              <div class="flex-1 min-w-0">
                <div class="text-zinc-300 truncate">{suggestion.content}</div>
                <div class="text-zinc-500 mt-0.5">
                  by <span class="text-zinc-400">{suggestion.authorGithubLogin}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function VotePoolPanel() {
  const collab = useCollab()

  return (
    <div class="p-2 space-y-1">
      <div class="flex items-center justify-between px-1 mb-2">
        <span class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Vote Pool</span>
        <button
          onClick={() => collab.resolvePool()}
          class="text-xs bg-yellow-500 hover:bg-yellow-400 text-black font-medium px-2 py-0.5 rounded"
        >
          Execute winner
        </button>
      </div>
      <Show when={collab.queue().length === 0}>
        <div class="text-xs text-zinc-600 px-1">No suggestions in pool</div>
      </Show>
      <For each={[...collab.queue()].sort((a, b) => b.voteScore - a.voteScore)}>
        {(suggestion) => (
          <VoteCard suggestion={suggestion} />
        )}
      </For>
    </div>
  )
}

function VoteCard(props: { suggestion: PromptSuggestion }) {
  const collab = useCollab()

  return (
    <div class="bg-zinc-800 rounded-md p-2">
      <div class="flex items-start gap-2">
        <button
          onClick={() => collab.castVote(props.suggestion.id)}
          class="flex-shrink-0 flex flex-col items-center gap-0.5 text-zinc-400 hover:text-blue-400 transition-colors"
          title="Vote for this prompt"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 3l7 7H3l7-7z" clip-rule="evenodd" />
          </svg>
          <span class="text-xs font-bold">{props.suggestion.voteScore}</span>
        </button>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-zinc-300">{props.suggestion.content}</div>
          <div class="text-xs text-zinc-500 mt-0.5">
            by <span class="text-zinc-400">{props.suggestion.authorGithubLogin}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PromptQueuePanel() {
  const collab = useCollab()
  const queueMode = () => collab.session()?.queueMode ?? "fifo"

  return (
    <Show when={queueMode() === "vote"} fallback={<FifoQueue />}>
      <VotePoolPanel />
    </Show>
  )
}

// ── Pending suggestions for Drivers to approve (FIFO mode) ─────────────────────

export function SuggestionApprovalPanel() {
  const collab = useCollab()
  const pending = () => collab.queue().filter((s) => s.status === "pending")

  return (
    <Show when={pending().length > 0}>
      <div class="p-2 border-t border-zinc-800">
        <div class="text-xs font-medium text-zinc-500 uppercase tracking-wider px-1 mb-2">
          Pending suggestions
        </div>
        <For each={pending()}>
          {(suggestion) => (
            <div class="bg-zinc-800/50 rounded-md p-2 mb-1">
              <div class="text-xs text-zinc-300 mb-1">{suggestion.content}</div>
              <div class="text-xs text-zinc-500 mb-2">
                by <span class="text-zinc-400">{suggestion.authorGithubLogin}</span>
              </div>
              <div class="flex gap-1">
                <button
                  onClick={() => collab.approvesuggestion(suggestion.id)}
                  class="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded"
                >
                  Approve
                </button>
                <button
                  onClick={() => collab.rejectSuggestion(suggestion.id)}
                  class="text-xs bg-zinc-600 hover:bg-zinc-500 text-zinc-300 px-2 py-0.5 rounded"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
