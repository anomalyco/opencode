import { For, Show, createSignal } from "solid-js"
import {
  sessions,
  currentSessionID,
  isLoadingSessions,
  selectSession,
  createSession,
  deleteSession,
} from "../stores/session"
import type { Session } from "../types"

export function SessionList() {
  const [isCreating, setIsCreating] = createSignal(false)
  const [deletingID, setDeletingID] = createSignal<string | null>(null)

  const handleCreateSession = async () => {
    setIsCreating(true)
    try {
      const session = await createSession({
        title: "New Session",
      })
      await selectSession(session.id)
    } catch (error) {
      console.error("Failed to create session:", error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteSession = async (sessionID: string, event: MouseEvent) => {
    event.stopPropagation()

    if (!confirm("Are you sure you want to delete this session?")) {
      return
    }

    setDeletingID(sessionID)
    try {
      await deleteSession(sessionID)
    } catch (error) {
      console.error("Failed to delete session:", error)
    } finally {
      setDeletingID(null)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString()
  }

  return (
    <div class="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      {/* Header */}
      <div class="p-4 border-b border-gray-800">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold text-gray-100">Sessions</h2>
          <button
            class="btn btn-primary text-sm py-1.5 px-3"
            onClick={handleCreateSession}
            disabled={isCreating()}
          >
            <Show when={isCreating()} fallback="+ New">
              Creating...
            </Show>
          </button>
        </div>
      </div>

      {/* Session List */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!isLoadingSessions()}
          fallback={
            <div class="p-4 text-center text-gray-500">
              <div class="animate-spin inline-block w-6 h-6 border-2 border-gray-600 border-t-primary-500 rounded-full" />
              <p class="mt-2">Loading sessions...</p>
            </div>
          }
        >
          <Show
            when={sessions().length > 0}
            fallback={
              <div class="p-4 text-center text-gray-500">
                <p>No sessions yet</p>
                <p class="text-sm mt-1">Create your first session to get started</p>
              </div>
            }
          >
            <For each={sessions()}>
              {(session) => (
                <SessionItem
                  session={session}
                  isActive={currentSessionID() === session.id}
                  isDeleting={deletingID() === session.id}
                  onSelect={() => selectSession(session.id)}
                  onDelete={(e) => handleDeleteSession(session.id, e)}
                  formatDate={formatDate}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

interface SessionItemProps {
  session: Session
  isActive: boolean
  isDeleting: boolean
  onSelect: () => void
  onDelete: (e: MouseEvent) => void
  formatDate: (timestamp: number) => string
}

function SessionItem(props: SessionItemProps) {
  return (
    <div
      class={`
        relative p-4 border-b border-gray-800 cursor-pointer
        transition-colors hover:bg-gray-800/50
        ${props.isActive ? "bg-gray-800 border-l-4 border-l-primary-500" : ""}
      `}
      onClick={props.onSelect}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-gray-100 truncate">
            {props.session.title || "Untitled Session"}
          </h3>
          <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{props.formatDate(props.session.time.updated)}</span>
            <Show when={props.session.agent}>
              <span>•</span>
              <span class="truncate">{props.session.agent}</span>
            </Show>
          </div>
        </div>

        <button
          class="
            p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400
            transition-colors opacity-0 group-hover:opacity-100
          "
          onClick={props.onDelete}
          disabled={props.isDeleting}
          title="Delete session"
        >
          <Show
            when={!props.isDeleting}
            fallback={
              <div class="w-4 h-4 border-2 border-gray-600 border-t-red-500 rounded-full animate-spin" />
            }
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </Show>
        </button>
      </div>
    </div>
  )
}
