/**
 * /collab/new — Create a new Collab Session
 *
 * Layout:
 *  ┌──────────────────┬────────────────────────────────────────┐
 *  │  Rejoin Session  │  New Collab Session (form)             │
 *  │    (1/4)         │            (3/4)                       │
 *  └──────────────────┴────────────────────────────────────────┘
 */

import { createSignal, createResource, onMount, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { CollabSession } from "@opencode-ai/collab"

interface OrgRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

export default function NewCollabSession() {
  const navigate = useNavigate()
  const [name, setName] = createSignal("")
  const [selectedRepos, setSelectedRepos] = createSignal<string[]>([])
  const [visibilityMode, setVisibilityMode] = createSignal("submitted")
  const [queueMode, setQueueMode] = createSignal("fifo")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [authed, setAuthed] = createSignal(false)

  // Check auth immediately on mount — redirect to GitHub OAuth if not logged in
  onMount(async () => {
    const res = await fetch("/collab/me")
    if (res.status === 401) {
      window.location.href = "/collab/auth/github?next=/collab/new"
      return
    }
    setAuthed(true)
  })

  // Load org repos once authenticated
  const [repos] = createResource(authed, async (ready) => {
    if (!ready) return []
    const res = await fetch("/collab/repos")
    if (!res.ok) return []
    return (await res.json()) as OrgRepo[]
  })

  // Load existing sessions for the "Rejoin Session" sidebar
  const [sessions] = createResource(authed, async (ready) => {
    if (!ready) return []
    const res = await fetch("/collab/session")
    if (!res.ok) return []
    return (await res.json()) as CollabSession[]
  })

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!name().trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/collab/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name().trim(),
          repos: selectedRepos(),
          visibilityMode: visibilityMode(),
          queueMode: queueMode(),
        }),
      })
      if (res.status === 401) {
        window.location.href = "/collab/auth/github?next=/collab/new"
        return
      }
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? "Failed to create session")
        return
      }
      const session = await res.json()
      navigate(`/collab/${session.id}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) =>
      prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName],
    )
  }

  return (
    <div class="h-screen bg-zinc-950 text-zinc-100 flex overflow-hidden">

      {/* ── LEFT: Rejoin Session sidebar (1/4) ──────────────────────────── */}
      <div class="w-72 flex-shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/40">

        {/* Sidebar header */}
        <div class="px-4 py-4 border-b border-zinc-800 flex-shrink-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
              Collab
            </span>
          </div>
          <h2 class="text-sm font-semibold text-zinc-100">Rejoin Session</h2>
          <p class="text-xs text-zinc-500 mt-0.5">Your previous coding sessions</p>
        </div>

        {/* Session list */}
        <div class="flex-1 overflow-y-auto py-2">
          <Show when={!authed()}>
            <div class="flex items-center gap-2 px-4 py-3 text-xs text-zinc-600">
              <svg class="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Signing in…
            </div>
          </Show>

          <Show when={authed() && sessions.loading}>
            <div class="px-4 py-3 text-xs text-zinc-600">Loading sessions…</div>
          </Show>

          <Show when={authed() && !sessions.loading && (sessions()?.length ?? 0) === 0}>
            <div class="px-4 py-6 text-center">
              <div class="w-10 h-10 rounded-full bg-zinc-800/60 flex items-center justify-center mx-auto mb-3">
                <svg class="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <p class="text-xs text-zinc-600">No sessions yet</p>
              <p class="text-[10px] text-zinc-700 mt-1">Create your first session →</p>
            </div>
          </Show>

          <Show when={authed() && !sessions.loading && (sessions()?.length ?? 0) > 0}>
            <For each={sessions()}>
              {(session) => (
                <button
                  onClick={() => navigate(`/collab/${session.id}`)}
                  class="w-full text-left px-4 py-3 hover:bg-zinc-800/60 transition-colors group border-b border-zinc-800/40 last:border-0"
                >
                  {/* Session name */}
                  <div class="flex items-start justify-between gap-2 mb-1.5">
                    <span class="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors leading-snug">
                      {session.name}
                    </span>
                    <svg
                      class="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 mt-0.5 transition-colors"
                      fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>

                  {/* Repos */}
                  <Show
                    when={(session.repos?.length ?? 0) > 0}
                    fallback={
                      <span class="text-[10px] text-zinc-700 italic">No repos linked</span>
                    }
                  >
                    <div class="flex flex-wrap gap-1">
                      <For each={session.repos}>
                        {(repo) => (
                          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-[10px] text-zinc-400">
                            <svg class="w-2.5 h-2.5 text-zinc-600 flex-shrink-0" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                            </svg>
                            {repo.split("/")[1] ?? repo}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Participants + queue mode badge */}
                  <div class="flex items-center gap-2 mt-1.5">
                    <Show when={(session.participants?.length ?? 0) > 0}>
                      <div class="flex items-center gap-1">
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
                        <span class="text-[10px] text-zinc-600">
                          {session.participants?.length ?? 0} member{(session.participants?.length ?? 0) !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </Show>
                    <span class="ml-auto text-[10px] text-zinc-700 uppercase tracking-wide">
                      {session.queueMode === "vote" ? "Vote" : "FIFO"}
                    </span>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* ── RIGHT: New Session form (3/4) ────────────────────────────────── */}
      <div class="flex-1 overflow-y-auto">
        <div class="w-full max-w-lg mx-auto px-8 py-12">
          <div class="mb-8">
            <h1 class="text-2xl font-semibold mb-1">New Collab Session</h1>
            <p class="text-sm text-zinc-400">
              Invite teammates to code together with a shared AI session.
            </p>
          </div>

          <Show when={authed()} fallback={
            <div class="flex items-center gap-2 text-zinc-500 text-sm">
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Signing in…
            </div>
          }>
            <form onSubmit={handleSubmit} class="space-y-6">
              {/* Session name */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">Session name</label>
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="e.g. Auth refactor sprint"
                  class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Repo selection */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">
                  Repositories
                  <span class="text-zinc-600 font-normal ml-1">(optional)</span>
                </label>
                <Show when={repos.loading}>
                  <div class="text-xs text-zinc-600 py-2">Loading org repos…</div>
                </Show>
                <Show when={!repos.loading && repos()?.length === 0}>
                  <div class="text-xs text-zinc-600 py-2">No repositories found in org</div>
                </Show>
                <Show when={(repos()?.length ?? 0) > 0}>
                  <div class="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-800">
                    <For each={repos()}>
                      {(repo) => (
                        <label class="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedRepos().includes(repo.full_name)}
                            onChange={() => toggleRepo(repo.full_name)}
                            class="rounded"
                          />
                          <div class="min-w-0">
                            <div class="text-sm text-zinc-200 truncate">{repo.name}</div>
                            <Show when={repo.description}>
                              <div class="text-xs text-zinc-600 truncate">{repo.description}</div>
                            </Show>
                          </div>
                          <Show when={repo.private}>
                            <span class="ml-auto text-xs text-zinc-600 flex-shrink-0">private</span>
                          </Show>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Visibility mode */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">
                  Visibility while typing
                </label>
                <div class="space-y-2">
                  <For each={[
                    { value: "submitted", label: "Submitted only", desc: "Others see prompts once you send them" },
                    { value: "typing", label: "Typing indicator", desc: 'Shows "Alex is typing…" while composing' },
                    { value: "live", label: "Live preview", desc: "Others see your draft in real time" },
                  ]}>
                    {(opt) => (
                      <label class="flex items-start gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-600">
                        <input
                          type="radio"
                          name="visibility"
                          value={opt.value}
                          checked={visibilityMode() === opt.value}
                          onChange={() => setVisibilityMode(opt.value)}
                          class="mt-0.5"
                        />
                        <div>
                          <div class="text-sm text-zinc-200">{opt.label}</div>
                          <div class="text-xs text-zinc-500">{opt.desc}</div>
                        </div>
                      </label>
                    )}
                  </For>
                </div>
              </div>

              {/* Queue mode */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">Prompt queue mode</label>
                <div class="space-y-2">
                  <For each={[
                    { value: "fifo", label: "FIFO", desc: "Prompts execute in the order they are submitted" },
                    { value: "vote", label: "Vote Pool", desc: "Team votes on suggestions; highest score executes first" },
                  ]}>
                    {(opt) => (
                      <label class="flex items-start gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-600">
                        <input
                          type="radio"
                          name="queueMode"
                          value={opt.value}
                          checked={queueMode() === opt.value}
                          onChange={() => setQueueMode(opt.value)}
                          class="mt-0.5"
                        />
                        <div>
                          <div class="text-sm text-zinc-200">{opt.label}</div>
                          <div class="text-xs text-zinc-500">{opt.desc}</div>
                        </div>
                      </label>
                    )}
                  </For>
                </div>
              </div>

              <Show when={error()}>
                <div class="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                  {error()}
                </div>
              </Show>

              <button
                type="submit"
                disabled={submitting() || !name().trim()}
                class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting() ? "Creating…" : "Create Collab Session"}
              </button>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}
