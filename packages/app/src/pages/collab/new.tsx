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
  const [branch, setBranch] = createSignal("")
  const [visibilityMode, setVisibilityMode] = createSignal("typing")
  const [queueMode, setQueueMode] = createSignal("fifo")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [authed, setAuthed] = createSignal(false)
  // 409-conflict modal state.  Server returns this when the user typed a
  // branch name like `collab/feature-x` and a linked repo already has a
  // `collab` leaf branch (refs/heads layout collision — see
  // packages/opencode/src/collab/branch-resolve.ts).
  const [branchConflict, setBranchConflict] = createSignal<{
    proposed: string
    suggested: string
    message: string
  } | null>(null)

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
  const [sessions, { refetch: refetchSessions }] = createResource(authed, async (ready) => {
    if (!ready) return []
    const res = await fetch("/collab/session")
    if (!res.ok) return []
    return (await res.json()) as CollabSession[]
  })

  // Identify the current user so we can hide the delete control from
  // non-Drivers (the DELETE endpoint enforces this server-side too).
  const [me] = createResource(authed, async (ready) => {
    if (!ready) return null
    const res = await fetch("/collab/me")
    if (!res.ok) return null
    return (await res.json()) as { githubId: number; githubLogin: string }
  })

  /** Returns true if the current user has the driver role in `session`. */
  function canDelete(session: CollabSession): boolean {
    const user = me()
    if (!user) return false
    return session.participants?.some(
      (p) => p.githubId === user.githubId && p.role === "driver",
    ) ?? false
  }

  /** Soft-delete a collab session.  Server also wipes the workspace clone. */
  async function deleteSession(e: MouseEvent, sessionId: string, sessionName: string) {
    // Stop the row's onClick (which navigates into the session) from firing.
    e.stopPropagation()
    e.preventDefault()
    if (!confirm(`Delete "${sessionName}"?\n\nThis removes the cloned workspace and cannot be undone.`)) {
      return
    }
    const res = await fetch(`/collab/session/${sessionId}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      alert(`Failed to delete session (HTTP ${res.status})${body ? ": " + body : ""}`)
      return
    }
    refetchSessions()
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!name().trim()) return
    setSubmitting(true)
    setError(null)
    setBranchConflict(null)
    await submitCreate(branch().trim() || undefined)
  }

  /** Inner submit — extracted so the 409 conflict modal can resubmit with the
   *  server-suggested branch name without re-running the form-validation
   *  guards. */
  async function submitCreate(branchOverride: string | undefined) {
    setSubmitting(true)
    try {
      const res = await fetch("/collab/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name().trim(),
          repos: selectedRepos(),
          visibilityMode: visibilityMode(),
          queueMode: queueMode(),
          branch: branchOverride,
        }),
      })
      if (res.status === 401) {
        window.location.href = "/collab/auth/github?next=/collab/new"
        return
      }
      if (res.status === 409) {
        // Branch collision on a user-typed name.  Surface the suggestion
        // modal so the user can accept the auto-rewrite or edit their
        // branch input.
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          suggestedBranch?: string
        }
        if (body.suggestedBranch) {
          setBranchConflict({
            proposed: branchOverride ?? "",
            suggested: body.suggestedBranch,
            message: body.error ?? "Branch name conflicts with an existing branch.",
          })
          return
        }
        setError(body.error ?? "Branch name conflict.")
        return
      }
      if (res.status === 502) {
        // GitHub API probe failed.  No DB row was created; user can retry.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(
          body.error ??
            "Could not reach GitHub to verify the branch name.  Please retry in a moment.",
        )
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

  /** Driver clicked "Use suggested" in the conflict modal. */
  async function acceptSuggestedBranch() {
    const conflict = branchConflict()
    if (!conflict) return
    setBranchConflict(null)
    setBranch(conflict.suggested)
    await submitCreate(conflict.suggested)
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
            {/* Consistent with the session-page header: the Collab pill links
                home so users always have a quick way to get back.  Forces a
                full page navigation (see comment on the same pill in
                pages/collab/session.tsx for why). */}
            <a
              href="/collab/new"
              title="Back to your collab sessions"
              onClick={(e) => {
                e.preventDefault()
                window.location.href = "/collab/new"
              }}
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider hover:bg-blue-500/30 hover:text-blue-300 transition-colors"
            >
              Collab
            </a>
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
                // Outer is a div (not a button) because we nest a real <button>
                // for the delete X — nested buttons are invalid HTML.
                <div
                  onClick={() => navigate(`/collab/${session.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      navigate(`/collab/${session.id}`)
                    }
                  }}
                  class="relative w-full text-left px-4 py-3 hover:bg-zinc-800/60 transition-colors group border-b border-zinc-800/40 last:border-0 cursor-pointer"
                >
                  {/* Delete X — only visible to Drivers, fades in on row hover */}
                  <Show when={canDelete(session)}>
                    <button
                      type="button"
                      onClick={(e) => deleteSession(e, session.id, session.name)}
                      title="Delete session"
                      aria-label={`Delete ${session.name}`}
                      class="absolute top-2 right-2 p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800/80 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </Show>

                  {/* Session name + open arrow.  pr-6 reserves space for the X. */}
                  <div class="flex items-start justify-between gap-2 mb-1.5 pr-6">
                    <span class="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors leading-snug">
                      {session.name}
                    </span>
                    <svg
                      class="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 mt-0.5 transition-colors group-hover:opacity-0"
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
                </div>
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
            {/* Container-wide Claude credentials banner — shows whether the
                server has a usable Claude auth file.  Any unleashlive org
                member can paste a fresh credentials JSON to overwrite it;
                whoever uploads last wins.  Server-side rate-limited 5/hr. */}
            <ClaudeCredentialsBanner />

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

              {/* Branch */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">
                  Git branch
                  <span class="text-zinc-600 font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="text"
                  value={branch()}
                  onInput={(e) => setBranch(e.currentTarget.value)}
                  placeholder="e.g. collab/drone-api-refactor — leave blank for auto-generated"
                  class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <p class="mt-1 text-[11px] text-zinc-600">
                  Every linked repo will be checked out to this branch.  If empty, a
                  branch named <code class="text-zinc-400">collab/&lt;slug&gt;-&lt;id&gt;</code> is created from the default branch.
                </p>
              </div>

              {/* Visibility mode */}
              <div>
                <label class="block text-sm font-medium text-zinc-300 mb-1.5">
                  Visibility while typing
                </label>
                <div class="space-y-2">
                  <For each={[
                    { value: "typing", label: "Typing indicator", desc: 'Shows a pulsing dot next to participants who are composing' },
                    { value: "submitted", label: "Submitted only", desc: "Others see prompts once you send them" },
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

      {/* Branch-collision modal: opens when POST /collab/session returns 409.
          The user typed a custom branch name with `/` that conflicts with an
          existing leaf branch in one of the linked repos.  Offer the
          server-suggested slash-flattened name (collab/foo → collab-foo)
          OR let the user edit the input and try again. */}
      <Show when={branchConflict()}>
        {(conflict) => (
          <div
            class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            style="z-index:99999"
            onClick={() => setBranchConflict(null)}
          >
            <div
              class="border border-border-weak-base rounded-xl p-6 w-full max-w-md shadow-2xl bg-background-base"
              style="position:relative;z-index:100000"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 class="text-base font-semibold text-text-strong mb-3">Branch name conflict</h2>
              <p class="text-sm text-text-weak mb-3 whitespace-pre-wrap">{conflict().message}</p>
              <p class="text-sm text-text-strong mb-4">
                Use{" "}
                <code class="px-1.5 py-0.5 rounded bg-background-stronger text-text-strong">
                  {conflict().suggested}
                </code>{" "}
                instead?
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  onClick={() => void acceptSuggestedBranch()}
                  disabled={submitting()}
                  class="flex-1 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
                >
                  {submitting() ? "Creating…" : "Use suggested"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBranch(conflict().proposed)
                    setBranchConflict(null)
                  }}
                  class="flex-1 py-2 rounded-lg text-sm font-medium bg-background-strong hover:bg-background-stronger text-text-strong transition-colors"
                >
                  Edit branch name
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

// ── Claude credentials banner ─────────────────────────────────────────────────
//
// Surfaces whether the server currently has a usable Claude auth file.  Any
// authenticated org member can paste a fresh credentials JSON (overwrites
// container-wide).  Why is this here rather than baked into session creation:
// the opencode-claude-auth plugin is process-wide — there's exactly one
// active Claude auth file per container, shared by every collab session.
// Per-session credentials would require spawning one opencode process per
// session (large architectural change); the per-container model is the
// realistic shape.
//
// Operator runbook for getting credentials JSON on a Mac:
//   security find-generic-password -s "Claude Code-credentials" -w
//
// The clipboard output of that command is exactly what goes in the textarea.

interface CredentialsStatus {
  present: boolean
  email?: string
  mtime?: number
  bytes?: number
}

function ClaudeCredentialsBanner() {
  const [status, setStatus] = createSignal<CredentialsStatus | null>(null)
  const [showUpload, setShowUpload] = createSignal(false)
  const [json, setJson] = createSignal("")
  const [uploading, setUploading] = createSignal(false)
  const [uploadErr, setUploadErr] = createSignal<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch("/collab/claude-creds/status", { cache: "no-store" })
      if (!res.ok) {
        setStatus({ present: false })
        return
      }
      setStatus((await res.json()) as CredentialsStatus)
    } catch {
      setStatus({ present: false })
    }
  }

  onMount(() => {
    void refresh()
  })

  async function upload(e: Event) {
    e.preventDefault()
    if (uploading() || !json().trim()) return
    setUploading(true)
    setUploadErr(null)
    try {
      const res = await fetch("/collab/claude-creds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialsJson: json() }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setUploadErr(body.error ?? `Server returned ${res.status}`)
      } else {
        setJson("")
        setShowUpload(false)
        await refresh()
      }
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div class="mb-6">
      <Show
        when={status() !== null}
        fallback={
          <div class="text-xs text-zinc-600 px-3 py-2">Checking Claude auth…</div>
        }
      >
        <Show
          when={status()!.present}
          fallback={
            // No credentials present — gentle warning + paste UI.
            <div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <div class="flex items-start gap-2">
                <svg class="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-amber-200">No Claude credentials on the server</p>
                  <p class="text-xs text-amber-300/80 mt-0.5">
                    Anthropic models won't be available until someone uploads a credentials file.  You can paste yours now, or skip and use a different model (the model picker shows free fallbacks).
                  </p>
                  <Show when={!showUpload()}>
                    <div class="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowUpload(true)}
                        class="text-xs px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-100 hover:bg-amber-500/30 transition-colors"
                      >
                        Paste credentials
                      </button>
                      <span class="text-[11px] text-amber-300/60">or just create a session and skip Anthropic</span>
                    </div>
                  </Show>
                </div>
              </div>

              <Show when={showUpload()}>
                <form onSubmit={upload} class="mt-3 space-y-2">
                  <details class="text-[11px] text-amber-300/80">
                    <summary class="cursor-pointer hover:text-amber-200">How to get the JSON (Mac)</summary>
                    <pre class="mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 overflow-x-auto">
{`security find-generic-password -s "Claude Code-credentials" -w`}
                    </pre>
                    <p class="mt-1">
                      Copy the entire output and paste below.  Three shapes are
                      accepted: Mac keychain dump (nested <code>claudeAiOauth</code>),
                      flat camelCase <code>{`{accessToken, refreshToken}`}</code>, or
                      flat snake_case <code>{`{access_token, refresh_token}`}</code>.
                      Stored on the server's EFS at <code>~/.local/share/opencode/claude-credentials.json</code>;
                      visible only to the running container.
                    </p>
                  </details>
                  <div class="bg-amber-500/15 border border-amber-500/30 rounded px-2 py-1.5 text-[11px] text-amber-100">
                    <strong>Shared across all collab sessions.</strong>  These
                    credentials authenticate every collab session on this
                    server.  LLM usage will be billed to your Claude account
                    until someone else uploads their own.  Per-session
                    isolation is tracked in{" "}
                    <a
                      href="https://github.com/unleashlive/opencode/issues/15"
                      target="_blank"
                      rel="noreferrer"
                      class="underline hover:text-amber-200"
                    >
                      issue #15
                    </a>
                    .
                  </div>
                  <textarea
                    value={json()}
                    onInput={(e) => setJson(e.currentTarget.value)}
                    placeholder='{"claudeAiOauth":{"accessToken":"sk-ant-...","refreshToken":"sk-ant-..."}}'
                    rows={5}
                    class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y"
                    spellcheck={false}
                    autocomplete="off"
                  />
                  <Show when={uploadErr()}>
                    <p class="text-[11px] text-red-400">{uploadErr()}</p>
                  </Show>
                  <div class="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={uploading() || !json().trim()}
                      class="text-xs px-3 py-1.5 rounded-md bg-amber-500/30 border border-amber-400/50 text-amber-50 hover:bg-amber-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploading() ? "Uploading…" : "Use these credentials"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowUpload(false); setJson(""); setUploadErr(null) }}
                      disabled={uploading()}
                      class="text-xs px-3 py-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </form>
              </Show>
            </div>
          }
        >
          {/* Credentials present — quiet green confirmation. */}
          <div class="flex items-center gap-2 text-xs text-emerald-300/90 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
            <svg class="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="flex-1">
              Claude credentials available
              <Show when={status()!.email}>
                <span class="text-emerald-400/70"> · {status()!.email}</span>
              </Show>
              <Show when={status()!.mtime}>
                <span class="text-emerald-400/60"> · refreshed {relativeTimeShort(status()!.mtime!)}</span>
              </Show>
            </span>
            <button
              type="button"
              onClick={() => setShowUpload((v) => !v)}
              class="text-[11px] text-emerald-400/70 hover:text-emerald-200"
            >
              {showUpload() ? "Cancel" : "Replace"}
            </button>
          </div>

          <Show when={showUpload()}>
            {/* Reuse the paste form when overwriting an existing file. */}
            <form onSubmit={upload} class="mt-2 space-y-2">
              <textarea
                value={json()}
                onInput={(e) => setJson(e.currentTarget.value)}
                placeholder='{"access_token":"...","refresh_token":"...","email":"..."}'
                rows={5}
                class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-y"
                spellcheck={false}
                autocomplete="off"
              />
              <Show when={uploadErr()}>
                <p class="text-[11px] text-red-400">{uploadErr()}</p>
              </Show>
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={uploading() || !json().trim()}
                  class="text-xs px-3 py-1.5 rounded-md bg-blue-600/30 border border-blue-500/40 text-blue-100 hover:bg-blue-600/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading() ? "Uploading…" : "Overwrite with these"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUpload(false); setJson(""); setUploadErr(null) }}
                  disabled={uploading()}
                  class="text-xs px-3 py-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

/** Cheap relative-time formatter — "5m", "2h", "Jun 14". */
function relativeTimeShort(mtimeMs: number): string {
  const diff = (Date.now() - mtimeMs) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(mtimeMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
