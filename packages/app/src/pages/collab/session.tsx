/**
 * /collab/:id — Collab Session view
 *
 * Wraps the existing opencode session UI with collab-specific panels:
 * - Participant list sidebar
 * - Prompt queue / vote pool panel
 * - Collab badge in the header
 */

import { Show, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { CollabProvider, useCollab } from "@/context/collab"
import { ParticipantList } from "@/components/collab/ParticipantList"
import { PromptQueuePanel, SuggestionApprovalPanel } from "@/components/collab/PromptQueuePanel"
import { CollabBadge } from "@/components/collab/CollabBadge"
import { CollabPromptInput } from "@/components/collab/CollabPromptInput"

function CollabSessionInner() {
  const collab = useCollab()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  return (
    <div class="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Main content area */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 flex-shrink-0">
          <div class="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              class="text-zinc-500 hover:text-zinc-300 p-1 rounded"
              title="Toggle participant sidebar"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span class="text-sm font-medium text-zinc-300 truncate">
              {collab.session()?.name ?? "Collab Session"}
            </span>
          </div>
          <CollabBadge />
        </div>

        {/* Session content — existing opencode session UI goes here */}
        <div class="flex-1 overflow-hidden flex flex-col">
          {/* Prompt queue panel */}
          <div class="border-b border-zinc-800 bg-zinc-900/30 flex-shrink-0">
            <PromptQueuePanel />
            <SuggestionApprovalPanel />
          </div>

          {/* Message thread placeholder — in production this renders the
              existing opencode <Session> component for the linked native session */}
          <div class="flex-1 overflow-y-auto p-4">
            <Show
              when={collab.session()?.sessionId}
              fallback={
                <div class="flex items-center justify-center h-full text-zinc-600 text-sm">
                  <div class="text-center">
                    <div class="text-lg mb-2">🚀</div>
                    <div>Submit a prompt to start coding</div>
                  </div>
                </div>
              }
            >
              {/* Linked native session messages rendered here by parent */}
              <div class="text-zinc-500 text-sm">Session active — messages appear here</div>
            </Show>
          </div>

          {/* Collab-aware prompt input */}
          <div class="border-t border-zinc-800 p-4 flex-shrink-0">
            <CollabPromptInput />
          </div>
        </div>
      </div>

      {/* Participants sidebar */}
      <Show when={sidebarOpen()}>
        <div class="w-56 border-l border-zinc-800 bg-zinc-900/50 flex-shrink-0 overflow-y-auto">
          <ParticipantList />
        </div>
      </Show>
    </div>
  )
}

export default function CollabSessionPage() {
  const params = useParams<{ id: string }>()

  return (
    <CollabProvider collabSessionId={params.id}>
      <CollabSessionInner />
    </CollabProvider>
  )
}
