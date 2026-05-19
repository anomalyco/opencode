/**
 * /collab/:id — Collab Session
 *
 * Layout:
 *  ┌────────────────┬───────────────────────────────────────┐
 *  │  Collab panel  │  Conversation (native session iframe)  │
 *  │    (1/4)       │            (3/4)                       │
 *  └────────────────┴───────────────────────────────────────┘
 *
 * The left panel handles participant management, role-based prompt
 * input, and the queue. The right panel embeds the full opencode
 * session UI via an iframe once the native session is created.
 */

import {
  createSignal,
  onMount,
  For,
  Show,
} from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { CollabProvider, useCollab } from "@/context/collab"
import { InviteDialog } from "@/components/collab/InviteDialog"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { CollabRole, Participant, PromptSuggestion } from "@opencode-ai/collab"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Me {
  githubId: number
  githubLogin: string
  githubAvatarUrl: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleColor(role: CollabRole) {
  return role === "driver"
    ? "text-amber-400"
    : role === "contributor"
      ? "text-blue-400"
      : "text-zinc-500"
}

function roleLabel(role: CollabRole) {
  return role === "driver" ? "Driver" : role === "contributor" ? "Contributor" : "Viewer"
}

// ── Participant avatar ─────────────────────────────────────────────────────────

function Avatar(props: { participant: Participant; size?: "sm" | "md" }) {
  const s = props.size === "md" ? "w-8 h-8" : "w-6 h-6"
  return (
    <div class="relative flex-shrink-0">
      <img
        src={props.participant.githubAvatarUrl || `https://github.com/${props.participant.githubLogin}.png?size=32`}
        alt={props.participant.githubLogin}
        class={`${s} rounded-full bg-zinc-800`}
      />
      <span
        class={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-zinc-900 ${props.participant.isOnline ? "bg-emerald-400" : "bg-zinc-600"}`}
      />
    </div>
  )
}

// ── Prompt input (role-aware) ─────────────────────────────────────────────────

function PromptInput(props: {
  collabSessionId: string
  role: CollabRole
  onSent: () => void
}) {
  const [text, setText] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [sendError, setSendError] = createSignal<string | null>(null)

  const isDriver = () => props.role === "driver"
  const isContributor = () => props.role === "contributor"

  async function submit(e: Event) {
    e.preventDefault()
    const content = text().trim()
    if (!content || busy()) return
    setBusy(true)
    setSendError(null)
    try {
      const res = await fetch(`/collab/session/${props.collabSessionId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setSendError((err as any).error ?? "Failed to send")
        return
      }
      setText("")
      props.onSent()
    } catch (err) {
      setSendError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.role !== "viewer"} fallback={
      <div class="px-3 py-2 text-xs text-zinc-600 text-center">
        Viewer — read only
      </div>
    }>
      <form onSubmit={submit} class="flex flex-col gap-2">
        <textarea
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit(e)
            }
          }}
          placeholder={isDriver() ? "Send a prompt… (⌘↵)" : "Suggest a prompt… (⌘↵)"}
          rows={3}
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
        />
        <Show when={sendError()}>
          <p class="text-xs text-red-400">{sendError()}</p>
        </Show>
        <button
          type="submit"
          disabled={busy() || !text().trim()}
          class={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 ${
            isDriver()
              ? "bg-blue-600 hover:bg-blue-500 text-white"
              : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
          }`}
        >
          {busy() ? "Sending…" : isDriver() ? "Add to Queue" : "Suggest"}
        </button>
      </form>
    </Show>
  )
}

// ── Queue item ────────────────────────────────────────────────────────────────

function QueueItem(props: {
  suggestion: PromptSuggestion
  myRole: CollabRole
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onVote?: (id: string) => void
}) {
  const s = props.suggestion
  return (
    <div class="px-3 py-2 border-b border-zinc-800/60 last:border-0">
      <div class="flex items-start gap-2">
        <img
          src={`https://github.com/${s.authorGithubLogin}.png?size=24`}
          class="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
          alt={s.authorGithubLogin}
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">{s.content}</p>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-[10px] text-zinc-600">{s.authorGithubLogin}</span>
            <span class={`text-[10px] font-medium ${
              s.status === "approved" ? "text-emerald-400" :
              s.status === "rejected" ? "text-red-400" : "text-zinc-500"
            }`}>
              {s.status}
            </span>
            <Show when={s.voteScore > 0}>
              <span class="text-[10px] text-blue-400">▲ {s.voteScore}</span>
            </Show>
          </div>
        </div>
      </div>
      <Show when={s.status === "pending" && props.myRole === "driver"}>
        <div class="flex gap-1.5 mt-2">
          <button
            onClick={() => props.onApprove?.(s.id)}
            class="flex-1 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => props.onReject?.(s.id)}
            class="flex-1 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
          >
            Reject
          </button>
        </div>
      </Show>
      <Show when={s.status === "pending" && props.myRole !== "driver" && props.myRole !== "viewer"}>
        <button
          onClick={() => props.onVote?.(s.id)}
          class="mt-1.5 px-2 py-0.5 rounded text-[10px] bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
        >
          ▲ Vote
        </button>
      </Show>
    </div>
  )
}

// ── Inner component (inside CollabProvider) ────────────────────────────────────

function CollabSessionInner(props: { me: Me }) {
  const collab = useCollab()
  const navigate = useNavigate()
  const [showInvite, setShowInvite] = createSignal(false)
  const [queueOpen, setQueueOpen] = createSignal(true)

  const myParticipant = () =>
    collab.session()?.participants.find((p) => p.githubId === props.me.githubId)

  const myRole = (): CollabRole => myParticipant()?.role ?? "viewer"

  const pendingQueue = () => collab.queue().filter((s) => s.status === "pending")

  function handleSent() {
    // Nothing to do — SSE will update queue
  }

  return (
    <div class="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">

      {/* ── LEFT: Collab panel (1/4) ─────────────────────────────────────── */}
      <div class="w-72 flex-shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/40">

        {/* Header */}
        <div class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
                Collab
              </span>
            </div>
            <h1 class="text-sm font-semibold text-zinc-100 truncate">
              {collab.session()?.name ?? "Loading…"}
            </h1>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            class="ml-2 p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 flex-shrink-0 transition-colors"
            title="Invite participants"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </button>
        </div>

        {/* Role badge */}
        <div class="px-4 py-2 border-b border-zinc-800/60 flex-shrink-0">
          <div class="flex items-center gap-2">
            <img
              src={props.me.githubAvatarUrl || `https://github.com/${props.me.githubLogin}.png?size=24`}
              class="w-5 h-5 rounded-full"
              alt={props.me.githubLogin}
            />
            <span class="text-xs text-zinc-400">{props.me.githubLogin}</span>
            <span class={`ml-auto text-xs font-medium ${roleColor(myRole())}`}>
              {roleLabel(myRole())}
            </span>
          </div>
        </div>

        {/* Participants */}
        <div class="px-4 py-3 border-b border-zinc-800/60 flex-shrink-0">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Participants</span>
            <span class="text-[10px] text-zinc-600">
              {collab.participants().filter(p => p.isOnline).length}/{collab.participants().length} online
            </span>
          </div>
          <div class="space-y-1.5">
            <For each={collab.participants()}>
              {(p) => (
                <div class="flex items-center gap-2">
                  <Avatar participant={p} size="sm" />
                  <span class="text-xs text-zinc-300 flex-1 truncate">{p.githubLogin}</span>
                  <span class={`text-[10px] ${roleColor(p.role)}`}>{roleLabel(p.role)}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Prompt input */}
        <div class="px-3 py-3 border-b border-zinc-800/60 flex-shrink-0">
          <PromptInput
            collabSessionId={collab.session()?.id ?? ""}
            role={myRole()}
            onSent={handleSent}
          />
        </div>

        {/* Queue */}
        <div class="flex-1 overflow-hidden flex flex-col min-h-0">
          <button
            onClick={() => setQueueOpen(v => !v)}
            class="w-full px-4 py-2 flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-wider font-medium hover:text-zinc-400 transition-colors"
          >
            <span>Queue</span>
            <div class="flex items-center gap-1">
              <Show when={pendingQueue().length > 0}>
                <span class="px-1.5 py-0.5 rounded-full bg-blue-600/30 text-blue-400 text-[10px]">
                  {pendingQueue().length}
                </span>
              </Show>
              <svg
                class={`w-3 h-3 transition-transform ${queueOpen() ? "rotate-180" : ""}`}
                fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          <Show when={queueOpen()}>
            <div class="flex-1 overflow-y-auto">
              <Show when={collab.queue().length === 0}>
                <div class="px-4 py-3 text-xs text-zinc-600">No prompts in queue</div>
              </Show>
              <For each={collab.queue()}>
                {(s) => (
                  <QueueItem
                    suggestion={s}
                    myRole={myRole()}
                    onApprove={(id) => collab.approvesuggestion(id)}
                    onReject={(id) => collab.rejectSuggestion(id)}
                    onVote={(id) => collab.castVote(id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Repos */}
        <Show when={(collab.session()?.repos?.length ?? 0) > 0}>
          <div class="px-4 py-3 border-t border-zinc-800/60 flex-shrink-0">
            <div class="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-1.5">Repos</div>
            <For each={collab.session()?.repos ?? []}>
              {(repo) => (
                <div class="flex items-center gap-1.5 py-0.5">
                  <svg class="w-3 h-3 text-zinc-600 flex-shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                  </svg>
                  <span class="text-xs text-zinc-500 truncate">{repo.split("/")[1] ?? repo}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* ── RIGHT: Conversation (3/4) — opencode session iframe ─────────── */}
      <div class="flex-1 flex flex-col min-w-0 relative">

        {/* Connection status badge (top-right corner) */}
        <div class="absolute top-2 right-3 z-10 flex items-center gap-1.5">
          <Show when={!collab.isConnected()}>
            <div class="flex items-center gap-1.5 text-xs text-amber-500 bg-zinc-900/80 px-2 py-1 rounded-full border border-zinc-700/50">
              <div class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Reconnecting…
            </div>
          </Show>
        </div>

        <Show
          when={collab.session()?.sessionId && collab.nativeSessionDirectory()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center text-center bg-zinc-950">
              <div class="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-5">
                <svg class="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <p class="text-sm font-medium text-zinc-400 mb-2">Conversation starts here</p>
              <p class="text-xs text-zinc-600 max-w-xs">
                {myRole() === "viewer"
                  ? "Waiting for a prompt to be approved"
                  : myRole() === "driver"
                    ? "Add a prompt to the queue and click Approve to start"
                    : "Suggest a prompt — a Driver must approve it to start"}
              </p>
            </div>
          }
        >
          {(_) => {
            const dir = collab.nativeSessionDirectory()!
            const sid = collab.session()!.sessionId!
            const sessionUrl = `/${base64Encode(dir)}/session/${sid}`
            return (
              <iframe
                src={sessionUrl}
                class="flex-1 w-full border-0 bg-zinc-950"
                title="Collab session"
                style="flex: 1; width: 100%; height: 100%; display: block;"
              />
            )
          }}
        </Show>
      </div>

      {/* Invite dialog */}
      <Show when={showInvite()}>
        <InviteDialog onClose={() => setShowInvite(false)} />
      </Show>
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function CollabSessionPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [me, setMe] = createSignal<Me | null>(null)

  onMount(async () => {
    const res = await fetch("/collab/me")
    if (res.status === 401) {
      window.location.href = `/collab/auth/github?next=/collab/${params.id}`
      return
    }
    setMe(await res.json())
  })

  return (
    <Show
      when={me()}
      fallback={
        <div class="h-screen bg-zinc-950 flex items-center justify-center">
          <div class="flex items-center gap-2 text-zinc-600 text-sm">
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Loading…
          </div>
        </div>
      }
    >
      {(meVal) => (
        <CollabProvider collabSessionId={params.id}>
          <CollabSessionInner me={meVal()} />
        </CollabProvider>
      )}
    </Show>
  )
}
