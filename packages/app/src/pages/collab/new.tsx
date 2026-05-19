/**
 * /collab/new — Create a new Collab Session
 */

import { createSignal, createResource, onMount, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"

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
    <div class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div class="w-full max-w-lg">
        <div class="mb-8">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              COLLAB
            </span>
          </div>
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
  )
}
