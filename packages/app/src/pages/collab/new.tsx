/**
 * /collab/new — Create a new Collab Session
 */

import { createSignal, createResource, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"

async function fetchOrgRepos(): Promise<Array<{ full_name: string; name: string }>> {
  // Fetch repos via the collab API (requires auth — will redirect to GitHub OAuth if not logged in)
  // Use a dummy session ID for repo listing; the router handles auth
  const res = await fetch("/collab/session/repos-preview")
  if (!res.ok) return []
  return res.json()
}

export default function NewCollabSession() {
  const navigate = useNavigate()
  const [name, setName] = createSignal("")
  const [selectedRepos, setSelectedRepos] = createSignal<string[]>([])
  const [visibilityMode, setVisibilityMode] = createSignal("submitted")
  const [queueMode, setQueueMode] = createSignal("fifo")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  async function loadRepos() {
    const res = await fetch("/collab/session")
    if (res.status === 401) {
      window.location.href = "/collab/auth/github?next=/collab/new"
      return []
    }
    // Re-use a known session to get repos — for new sessions just list org repos
    const orgRes = await fetch("/collab/session/org-repos")
    if (!orgRes.ok) return []
    return orgRes.json()
  }

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
          <h1 class="text-2xl font-semibold mb-1">New Collab Session</h1>
          <p class="text-sm text-zinc-400">
            Invite teammates to code together with a shared LLM session.
          </p>
        </div>

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

          {/* Visibility mode */}
          <div>
            <label class="block text-sm font-medium text-zinc-300 mb-1.5">
              Visibility while typing
            </label>
            <div class="space-y-2">
              {[
                { value: "submitted", label: "Submitted only", desc: "Others see prompts once you send them" },
                { value: "typing", label: "Typing indicator", desc: 'Shows "Alex is typing..." while composing' },
                { value: "live", label: "Live preview", desc: "Others see your draft in real time" },
              ].map((opt) => (
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
              ))}
            </div>
          </div>

          {/* Queue mode */}
          <div>
            <label class="block text-sm font-medium text-zinc-300 mb-1.5">Prompt queue mode</label>
            <div class="space-y-2">
              {[
                { value: "fifo", label: "FIFO", desc: "Prompts execute in the order they are submitted" },
                {
                  value: "vote",
                  label: "Vote Pool",
                  desc: "Team votes on suggestions; highest score executes first",
                },
              ].map((opt) => (
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
              ))}
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
      </div>
    </div>
  )
}
