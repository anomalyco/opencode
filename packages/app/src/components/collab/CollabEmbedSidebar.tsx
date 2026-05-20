/**
 * Sidebar rendered inside the opencode iframe when ?embed=collab is set.
 *
 * Replaces the default project rail/panel with a list of the current user's
 * collab sessions.  Clicking a session navigates the *top* window (out of
 * the iframe) to that collab session's page — same content as the homepage
 * session history list.
 */

import { createResource, For, Show, createMemo } from "solid-js"
import type { CollabSession } from "@opencode-ai/collab"
import { collabEmbedSessionId, navigateTopToCollabSession } from "@/utils/collab-embed"

interface Me {
  githubId: number
  githubLogin: string
}

export function CollabEmbedSidebar() {
  const activeSessionId = createMemo(() => collabEmbedSessionId())

  const [me] = createResource(async () => {
    const res = await fetch("/collab/me")
    if (!res.ok) return null
    return (await res.json()) as Me
  })

  const [sessions, { refetch }] = createResource(async () => {
    const res = await fetch("/collab/session")
    if (!res.ok) return []
    return (await res.json()) as CollabSession[]
  })

  function canDelete(session: CollabSession): boolean {
    const user = me()
    if (!user) return false
    return session.participants?.some(
      (p) => p.githubId === user.githubId && p.role === "driver",
    ) ?? false
  }

  async function deleteSession(e: MouseEvent, session: CollabSession) {
    e.stopPropagation()
    e.preventDefault()
    if (!confirm(`Delete "${session.name}"?\n\nThis removes the cloned workspace and cannot be undone.`)) {
      return
    }
    const res = await fetch(`/collab/session/${session.id}`, { method: "DELETE" })
    if (!res.ok) {
      alert(`Failed to delete (HTTP ${res.status})`)
      return
    }
    // If we just deleted the session we were viewing, bounce to /collab/new
    if (session.id === activeSessionId()) {
      const top = window.top ?? window
      top.location.href = "/collab/new"
      return
    }
    refetch()
  }

  return (
    <div class="flex h-full w-full flex-col bg-zinc-900/40 border-r border-zinc-800">
      {/* Header */}
      <div class="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
            Collab
          </span>
        </div>
        <h2 class="text-sm font-semibold text-zinc-100">Sessions</h2>
        <p class="text-xs text-zinc-500 mt-0.5">Switch between coding sessions</p>
      </div>

      {/* New session button */}
      <div class="px-3 py-2 border-b border-zinc-800/60 flex-shrink-0">
        <button
          type="button"
          onClick={() => {
            const top = window.top ?? window
            top.location.href = "/collab/new"
          }}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-white transition-colors"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Collab Session
        </button>
      </div>

      {/* Session list */}
      <div class="flex-1 overflow-y-auto py-1">
        <Show when={sessions.loading}>
          <div class="px-4 py-3 text-xs text-zinc-600">Loading sessions…</div>
        </Show>

        <Show when={!sessions.loading && (sessions()?.length ?? 0) === 0}>
          <div class="px-4 py-6 text-center text-xs text-zinc-600">No sessions</div>
        </Show>

        <For each={sessions()}>
          {(session) => {
            const isActive = () => session.id === activeSessionId()
            return (
              <div
                onClick={() => navigateTopToCollabSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    navigateTopToCollabSession(session.id)
                  }
                }}
                classList={{
                  "relative w-full text-left px-4 py-2.5 transition-colors group border-b border-zinc-800/40 last:border-0 cursor-pointer": true,
                  "bg-blue-500/10 border-l-2 border-l-blue-500": isActive(),
                  "hover:bg-zinc-800/60": !isActive(),
                }}
              >
                {/* Delete X — Drivers only, fades in on hover */}
                <Show when={canDelete(session)}>
                  <button
                    type="button"
                    onClick={(e) => deleteSession(e, session)}
                    title="Delete session"
                    aria-label={`Delete ${session.name}`}
                    class="absolute top-1.5 right-1.5 p-0.5 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800/80 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Show>

                <div class="pr-5">
                  <div
                    classList={{
                      "text-sm font-medium leading-snug truncate": true,
                      "text-white": isActive(),
                      "text-zinc-200 group-hover:text-white": !isActive(),
                    }}
                  >
                    {session.name}
                  </div>

                  <Show when={(session.repos?.length ?? 0) > 0}>
                    <div class="flex flex-wrap gap-1 mt-1">
                      <For each={session.repos.slice(0, 2)}>
                        {(repo) => (
                          <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-[10px] text-zinc-400">
                            {repo.split("/")[1] ?? repo}
                          </span>
                        )}
                      </For>
                      <Show when={(session.repos?.length ?? 0) > 2}>
                        <span class="text-[10px] text-zinc-600">+{session.repos.length - 2}</span>
                      </Show>
                    </div>
                  </Show>

                  <div class="flex items-center gap-2 mt-1">
                    <Show when={(session.participants?.length ?? 0) > 0}>
                      <div class="flex -space-x-1">
                        <For each={(session.participants ?? []).slice(0, 3)}>
                          {(p) => (
                            <img
                              src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=16`}
                              alt={p.githubLogin}
                              class="w-4 h-4 rounded-full border border-zinc-900"
                              title={p.githubLogin}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                    <span class="ml-auto text-[10px] text-zinc-700 uppercase tracking-wide">
                      {session.queueMode === "vote" ? "Vote" : "FIFO"}
                    </span>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
