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
  createResource,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js"
import { useParams } from "@solidjs/router"
import { CollabProvider, useCollab } from "@/context/collab"
import { InviteDialog } from "@/components/collab/InviteDialog"
import { TeamNoteComposer } from "@/components/collab/TeamNoteComposer"
import { PreviewLauncher } from "@/components/collab/PreviewLauncher"
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
      {/* Online dot uses INLINE style for the bg colour so it doesn't depend
          on Tailwind JIT detection of the conditional class — that turned out
          to be unreliable for the collab page in earlier builds, leaving the
          dot transparent / page-coloured (looked black). */}
      <span
        class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-zinc-900"
        style={{
          "background-color": props.participant.isOnline ? "#34d399" : "#52525b",
        }}
        title={props.participant.isOnline ? "Online" : "Offline"}
      />
    </div>
  )
}

// ── Participant row (Avatar + name + typing dots + role) ───────────────────────

/**
 * One row of the participants list.
 *
 * Pulled out as its own component to give the typing-dots a clean reactive
 * boundary.  Previously the dots were rendered inline inside the `<For>`
 * callback in CollabSessionInner — Solid's tracking *should* pick that up
 * (the `typing()` accessor reads the `typingUsers` signal) but the
 * compiler was apparently optimising the access away, and the dots never
 * appeared even though the SSE event fired.  An explicit component
 * boundary makes the dependency explicit.
 */
function ParticipantRow(props: {
  participant: Participant
  typing: () => boolean
  roleColorClass: string
  roleLabel: string
  /** Number of unread @-mentions for THIS participant (only ever non-zero for the local user). */
  unreadMentions?: () => number
}) {
  const unread = () => props.unreadMentions?.() ?? 0
  return (
    <div class="flex items-center gap-2">
      <div class="relative">
        <Avatar participant={props.participant} size="sm" />
        {/* Red mention badge — only shows on the local user's row when
            they have unread @-mentions. */}
        <Show when={unread() > 0}>
          <span
            class="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ "background-color": "#ef4444", color: "#fff" }}
            title={`${unread()} unread @-mention${unread() === 1 ? "" : "s"}`}
          >
            {unread() > 9 ? "9+" : unread()}
          </span>
        </Show>
      </div>
      <span class="text-xs text-zinc-300 flex-1 truncate">{props.participant.githubLogin}</span>
      <Show when={props.typing()}>
        <span
          class="flex items-center gap-1"
          title={`${props.participant.githubLogin} is typing…`}
          aria-label={`${props.participant.githubLogin} is typing`}
        >
          {/* Inline bg-colour + animation-delay so neither Tailwind JIT
              detection nor arbitrary-value class compilation can break
              the indicator. */}
          <span
            class="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ "background-color": "#60a5fa", "animation-delay": "0ms" }}
          />
          <span
            class="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ "background-color": "#60a5fa", "animation-delay": "200ms" }}
          />
          <span
            class="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ "background-color": "#60a5fa", "animation-delay": "400ms" }}
          />
        </span>
      </Show>
      <span class={`text-[10px] ${props.roleColorClass}`}>{props.roleLabel}</span>
    </div>
  )
}

// ── Open-PR button ────────────────────────────────────────────────────────────

/**
 * Driver-only button rendered in the left collab panel.  Calls
 * POST /collab/session/:id/pr which git-pushes the current branch and
 * opens a pull request on GitHub.  Surfaces the PR URL on success;
 * surfaces the GitHub error verbatim on failure (e.g. "no commits
 * yet").
 */
function OpenPrButton() {
  const collab = useCollab()
  const [busy, setBusy] = createSignal(false)
  const [prUrl, setPrUrl] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  // Lock the button out for the rest of the page lifetime when the branch
  // has no commits yet.  The server-side wrap (github-pr.ts) returns a
  // friendly 400 in that case; the SPA picks up on that exact wording so
  // it doesn't have to know about the underlying GitHub 422.  Either side
  // alone would do the job — keeping both is defence-in-depth (Q2 "both"
  // path in the deploy review): the server stops bad PRs from being
  // created, the client stops the user from re-clicking into the same
  // error message a dozen times.
  const [locked, setLocked] = createSignal(false)

  /** Heuristic for the "no commits yet" condition.  Both the wrapped 400
   *  ("No commits to open a PR with yet.") and the raw GitHub 422
   *  ("No commits between …") fall in here, in case anything bypasses
   *  the server-side wrap (older deployments, partial rollouts). */
  function looksLikeEmptyBranch(message: string): boolean {
    return /no commits (to open|between)/i.test(message)
  }

  async function openPr() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await collab.openPullRequest()
      setPrUrl(url)
      // Auto-open the PR in a new tab for the Driver.
      window.open(url, "_blank", "noreferrer")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      if (looksLikeEmptyBranch(message)) setLocked(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="px-3 py-3 border-t border-zinc-800/60 flex-shrink-0 space-y-1.5">
      <button
        type="button"
        onClick={openPr}
        disabled={busy() || locked()}
        title={locked() ? "No commits on the collab branch yet — ask the LLM to make a commit first." : undefined}
        class="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
      >
        <Show
          when={!busy()}
          fallback={
            <>
              <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Opening PR…
            </>
          }
        >
          {/* git-pull-request icon */}
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="6" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path stroke-linecap="round" d="M6 8v8M18 8v8" />
          </svg>
          Open Pull Request
        </Show>
      </button>
      <Show when={prUrl()}>
        <a
          href={prUrl()!}
          target="_blank"
          rel="noreferrer"
          class="block text-[11px] text-emerald-400 hover:text-emerald-300 truncate"
          title={prUrl()!}
        >
          → {prUrl()}
        </a>
      </Show>
      <Show when={error()}>
        <div class="text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1 whitespace-pre-wrap">
          {error()}
        </div>
      </Show>
    </div>
  )
}

// ── Prompt input (role-aware) ─────────────────────────────────────────────────

function PromptInput(props: {
  collabSessionId: string
  role: CollabRole
  queueMode: "fifo" | "vote"
  onSent: () => void
}) {
  const [text, setText] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [sendError, setSendError] = createSignal<string | null>(null)

  const isDriver = () => props.role === "driver"
  const isContributor = () => props.role === "contributor"
  /** Driver in FIFO mode → prompt goes straight to the LLM (no approval). */
  const isDirectSend = () => isDriver() && props.queueMode === "fifo"

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
          placeholder={
            isDirectSend()
              ? "Send a prompt… (⌘↵)"
              : isDriver()
                ? "Add a prompt to the pool… (⌘↵)"
                : "Suggest a prompt… (⌘↵)"
          }
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
          {busy()
            ? "Sending…"
            : isDirectSend()
              ? "Send"
              : isDriver()
                ? "Add to Pool"
                : "Suggest"}
        </button>
      </form>
    </Show>
  )
}

// ── Queue item ────────────────────────────────────────────────────────────────

/** The fixed set of emoji shown in the reaction bar (kept in sync with
 *  REACTION_EMOJIS in packages/collab/src/types.ts). */
const REACTION_BAR: readonly string[] = ["👍", "👎", "🔥", "🚀", "❤️", "😄"]

/** Match GitHub-style @-mentions (1–39 chars from [A-Za-z0-9-], start
 *  with alnum).  Mirrors the server-side MENTION_RE in mentions.ts. */
const MENTION_RE = /(^|\s)(@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g

/** Render free-text content with @-mentions highlighted as inline pills. */
function renderMentions(text: string) {
  const parts: Array<string | { mention: string }> = []
  let lastIndex = 0
  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(text)) !== null) {
    const start = m.index + m[1]!.length // skip the leading whitespace/start
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push({ mention: m[2]! })
    lastIndex = MENTION_RE.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.map((p) =>
    typeof p === "string" ? (
      p
    ) : (
      <span
        class="inline-block px-1 rounded font-medium"
        style={{ "background-color": "rgba(96,165,250,0.18)", color: "#60a5fa" }}
      >
        {p.mention}
      </span>
    ),
  )
}

function QueueItem(props: {
  suggestion: PromptSuggestion
  myRole: CollabRole
  myLogin: string
  onApprove?: (id: string) => Promise<void>
  onReject?: (id: string) => void
  onVote?: (id: string) => void
  onReact?: (id: string, emoji: string) => void
}) {
  const s = props.suggestion
  const [approving, setApproving] = createSignal(false)
  const [approveError, setApproveError] = createSignal<string | null>(null)

  async function handleApprove() {
    setApproving(true)
    setApproveError(null)
    try {
      await props.onApprove?.(s.id)
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : String(err))
    } finally {
      setApproving(false)
    }
  }

  return (
    <div class="px-3 py-2 border-b border-zinc-800/60 last:border-0">
      <div class="flex items-start gap-2">
        <img
          src={`https://github.com/${s.authorGithubLogin}.png?size=24`}
          class="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
          alt={s.authorGithubLogin}
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
            {renderMentions(s.content)}
          </p>
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
        <div class="flex flex-col gap-1 mt-2">
          <div class="flex gap-1.5">
            <button
              onClick={handleApprove}
              disabled={approving()}
              class="flex-1 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
            >
              {approving() ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={() => props.onReject?.(s.id)}
              class="flex-1 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
            >
              Reject
            </button>
          </div>
          <Show when={approveError()}>
            <p class="text-[10px] text-red-400">{approveError()}</p>
          </Show>
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

      {/* Reaction bar — non-Viewers only.  Each emoji is its own toggle;
          re-clicking removes your own reaction.  Counts come from the
          server-broadcast reaction map. */}
      <Show when={props.myRole !== "viewer"}>
        <div class="flex flex-wrap gap-1 mt-1.5">
          <For each={REACTION_BAR}>
            {(emoji) => {
              const reactors = () => s.reactions?.[emoji] ?? []
              const mine = () => reactors().includes(props.myLogin)
              const count = () => reactors().length
              return (
                <button
                  type="button"
                  onClick={() => props.onReact?.(s.id, emoji)}
                  title={count() > 0 ? reactors().join(", ") : `React with ${emoji}`}
                  classList={{
                    "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border transition-colors": true,
                    "bg-blue-500/20 text-blue-300 border-blue-500/40": mine(),
                    "bg-zinc-800/60 text-zinc-500 border-zinc-700/40 hover:bg-zinc-700/60 hover:text-zinc-300": !mine(),
                  }}
                >
                  <span>{emoji}</span>
                  <Show when={count() > 0}>
                    <span class="font-mono">{count()}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Inner component (inside CollabProvider) ────────────────────────────────────

function CollabSessionInner(props: { me: Me }) {
  const collab = useCollab()
  const [showInvite, setShowInvite] = createSignal(false)
  const [queueOpen, setQueueOpen] = createSignal(true)
  const [submitError, setSubmitError] = createSignal<string | null>(null)

  const myParticipant = () =>
    collab.session()?.participants.find((p) => p.githubId === props.me.githubId)

  const myRole = (): CollabRole => myParticipant()?.role ?? "viewer"

  const pendingQueue = () => collab.queue().filter((s) => s.status === "pending")

  function handleSent() {
    // Nothing to do — SSE will update queue
  }

  /**
   * Listen for prompt submissions from inside the opencode iframe.  The
   * iframe's PromptInput posts `opencode:collab-prompt-submit` when in
   * embed mode, instead of dispatching to opencode directly.  We forward
   * the content through the collab API so it gets queue / approval /
   * direct-dispatch routing based on (queueMode, role).
   */
  onMount(() => {
    function onIframeMessage(event: MessageEvent) {
      // Same-origin only — the iframe runs at the same origin as this page.
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || typeof data !== "object") return

      // Prompt submission: route through the collab queue.
      if (data.type === "opencode:collab-prompt-submit") {
        const content = typeof data.content === "string" ? data.content.trim() : ""
        if (!content) return
        if (myRole() === "viewer") {
          setSubmitError("Viewers cannot send prompts.")
          return
        }
        setSubmitError(null)
        const model = typeof data.model === "string" ? data.model : undefined
        const agent = typeof data.agent === "string" ? data.agent : undefined
        const variant = typeof data.variant === "string" ? data.variant : undefined
        collab.submitPrompt(content, model, agent, variant).catch((err) => {
          setSubmitError(err instanceof Error ? err.message : String(err))
        })
        return
      }

      // Typing indicator: forward to the server so other participants
      // see a pulsing dot next to this user (when visibilityMode === "typing").
      if (data.type === "opencode:collab-typing") {
        if (myRole() === "viewer") return
        void collab.setTyping(Boolean(data.typing))
        return
      }
    }
    window.addEventListener("message", onIframeMessage)
    onCleanup(() => window.removeEventListener("message", onIframeMessage))
  })

  return (
    <div class="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">

      {/* ── LEFT: Collab panel (1/4) ─────────────────────────────────────── */}
      <div class="w-72 flex-shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/40">

        {/* Header */}
        <div class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-0.5">
              {/* "Collab" pill links back to the home / new-session page so
                  any participant can quickly hop to the list of all their
                  sessions or create a new one.

                  We deliberately force a FULL page navigation rather than a
                  client-side SPA route change.  @solidjs/router intercepts
                  same-origin <a href> clicks and tries to dynamic-import
                  the target route's lazy chunk — that chunk's hashed
                  filename rotates on every deploy, so a user with a stale
                  bundle hits "Failed to fetch dynamically imported module".
                  Hard navigation makes the browser fetch a fresh
                  index.html + the latest bundle, sidestepping the issue. */}
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
                <ParticipantRow
                  participant={p}
                  typing={() => collab.typingUsers().has(p.githubLogin)}
                  roleColorClass={roleColor(p.role)}
                  roleLabel={roleLabel(p.role)}
                  unreadMentions={
                    p.githubId === props.me.githubId ? collab.unreadMentions : undefined
                  }
                />
              )}
            </For>
          </div>
        </div>

        {/* Prompt input — the actual textarea lives in the opencode iframe on
            the right (so users get all the opencode shortcuts: ⌘P, /, @,
            attachments, drag/drop, history, etc).  Submissions there are
            intercepted and routed through the collab queue via postMessage.
            A compact one-line hint points users at the editor; the larger
            real estate goes to the Team Notes composer below for human-to-
            human side-chat with @-mentions (which fight opencode's `@` key
            inside the iframe). */}
        <div class="px-3 py-2 border-b border-zinc-800/60 flex-shrink-0 space-y-1">
          <div class="text-[11px] text-zinc-500 leading-snug">
            <span class="text-zinc-300">Prompt the LLM in the editor on the right →</span>{" "}
            <span class="text-zinc-600">
              {myRole() === "viewer"
                ? "(Viewers read along.)"
                : myRole() === "driver" && collab.session()?.queueMode === "fifo"
                  ? "Sent prompts go straight to the LLM."
                  : myRole() === "driver"
                    ? "Your prompts join the vote pool."
                    : "Your prompts go to the queue for Driver approval."}
            </span>
          </div>
          <Show when={submitError()}>
            <div class="mt-1 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1">
              {submitError()}
            </div>
          </Show>
        </div>

        {/* Team Notes — side-channel chat for the participants, never reaches
            the LLM.  Owns its own `@` autocomplete so people can ping each
            other without fighting opencode's file-mention popover. */}
        <TeamNoteComposer readonly={myRole() === "viewer"} />

        {/* Queue — takes the remaining vertical space in the sidebar and
            scrolls internally when many prompt suggestions flow in.  The
            `min-h-0` on both the container AND the scroll child is load-
            bearing: a flex child defaults to `min-height: auto` (i.e.
            expand to content), so without it the inner list grows past
            the allotted flex-1 height and overflow never engages. */}
        <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
          <button
            onClick={() => {
              setQueueOpen(v => !v)
              collab.clearMentions()
            }}
            class="flex-shrink-0 w-full px-3 py-2 flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-wider font-medium hover:text-zinc-400 transition-colors"
          >
            <span>Queue</span>
            <div class="flex items-center gap-1.5">
              <Show when={pendingQueue().length > 0}>
                <span class="px-1.5 py-0.5 rounded-full bg-blue-600/30 text-blue-400 text-[10px] normal-case tracking-normal">
                  {pendingQueue().length}
                </span>
              </Show>
              <svg
                class={`w-3.5 h-3.5 transition-transform ${queueOpen() ? "rotate-180" : ""}`}
                fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          <Show when={queueOpen()}>
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <Show when={collab.queue().length === 0}>
                <div class="px-4 py-3 text-xs text-zinc-600">No prompts in queue</div>
              </Show>
              <For each={collab.queue()}>
                {(s) => (
                  <QueueItem
                    suggestion={s}
                    myRole={myRole()}
                    myLogin={props.me.githubLogin}
                    onApprove={(id) => collab.approvesuggestion(id)}
                    onReject={(id) => { collab.rejectSuggestion(id).catch(console.error) }}
                    onVote={(id) => { collab.castVote(id).catch(console.error) }}
                    onReact={(id, emoji) => { collab.react(id, emoji).catch(console.error) }}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Frontend live-preview launcher — renders only when the session
            has a preview-capable repo (.opencode-preview.json present OR a
            repo named "frontend").  See packages/opencode/src/collab/preview-launcher.ts
            and ~/.claude/plans/frontend-live-preview.md.  Self-hides
            otherwise; visible to all participants but only Drivers can click. */}
        <PreviewLauncher />

        {/* Open PR — Drivers only, only when at least one repo is linked. */}
        <Show when={myRole() === "driver" && (collab.session()?.repos?.length ?? 0) > 0}>
          <OpenPrButton />
        </Show>

        {/* Repos — each row also shows the active branch in that repo.
            The "preview :port" pills live next to the Repos title (rather
            than top-right over the iframe) so they're anchored to the
            workspace context they belong to. */}
        <Show when={(collab.session()?.repos?.length ?? 0) > 0}>
          <div class="px-4 py-3 border-t border-zinc-800/60 flex-shrink-0">
            <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <div class="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
                Repos
              </div>
              <For each={collab.previewPorts()}>
                {(port) => (
                  <a
                    href={`/preview/${port}/`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open live preview for port ${port} (proxied via /preview/${port}/)`}
                    class="flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded-full border border-emerald-500/30 transition-colors"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    preview :{port}
                    <svg class="w-2 h-2" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </a>
                )}
              </For>
            </div>
            <For each={collab.session()?.repos ?? []}>
              {(repo) => {
                // Prefer the live-read current HEAD per repo (works for
                // legacy sessions too where collab_session.branch is null
                // because the column didn't exist when they were created).
                // Fall back to the session-level branch as a secondary
                // source.
                const repoBranch = () =>
                  collab.session()?.repoBranches?.[repo] ?? collab.session()?.branch ?? null
                return (
                  <div class="py-1">
                    <div class="flex items-center gap-1.5">
                      <svg class="w-3 h-3 text-zinc-600 flex-shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                      </svg>
                      <span class="text-xs text-zinc-500 truncate">{repo.split("/")[1] ?? repo}</span>
                    </div>
                    <Show when={repoBranch()}>
                      <div
                        class="flex items-center gap-1.5 mt-0.5 ml-[18px]"
                        title={`Current branch in ${repo}: ${repoBranch()}`}
                      >
                        <svg class="w-2.5 h-2.5 text-emerald-500/80 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <circle cx="6" cy="6" r="2" />
                          <circle cx="6" cy="18" r="2" />
                          <circle cx="18" cy="12" r="2" />
                          <path stroke-linecap="round" d="M6 8v8M6 12c0-3.314 2.686-6 6-6h4" />
                        </svg>
                        <span class="text-[11px] text-emerald-400/90 font-mono truncate">
                          {repoBranch()}
                        </span>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* ── RIGHT: Conversation (3/4) — opencode session iframe ─────────── */}
      <div class="flex-1 flex flex-col min-w-0 relative">

        {/* Top-right chrome — connection status only.  The preview-port
            pills now live next to the "Repos" title in the left panel. */}
        <Show when={!collab.isConnected()}>
          <div class="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-xs text-amber-500 bg-zinc-900/80 px-2 py-1 rounded-full border border-zinc-700/50">
            <div class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Reconnecting…
          </div>
        </Show>

        {/* Iframe gate: no repos → render the recovery panel instead of the
            iframe.  Server side enforces the same — /<base64>/?cs=<id> with
            an empty-repos session 401s (see cookie-auth.ts).  Both are needed:
            client side for UX (no broken iframe), server side for security
            (no URL-crafting around the gate). */}
        <Show
          when={(collab.session()?.repos.length ?? 0) > 0}
          fallback={<EmptyReposPanel />}
        >

        {/* Triple gate before the iframe mounts:
              1. initStatus === "ready"  — workspace clone + branch checkout
                                            actually finished on the server.
              2. nativeSessionDirectory   — set by collab:native_session_linked.
              3. sessionId                — same SSE event.

            initStatus is the load-bearing one this fix adds.  Previously
            the gate only required (2) + (3), which the broken-fallback
            preWarm could satisfy even after a clone failure — the iframe
            would mount pointing at an empty workspace and the prompt input
            would lock up because opencode's InstanceStore had nothing to
            attach to.  See docs/adr/0001 and the fix/session commits.

            initStatus === "failed" → the recovery panel takes over.  Driver
            gets a retry button; everyone else sees the failure reason and
            is told to wait. */}
        <Show
          when={collab.session()?.initStatus === "failed"}
          fallback={
            <Show
              when={
                (collab.session()?.initStatus ?? "ready") === "ready" &&
                collab.nativeSessionDirectory() &&
                collab.session()?.sessionId
              }
              fallback={<PreparingWorkspacePanel />}
            >
          {(_) => {
            const dir = collab.nativeSessionDirectory()!
            const sid = collab.session()!.sessionId!
            const cid = collab.session()!.id
            const sessionUrl = `/${base64Encode(dir)}/session/${sid}?embed=collab&cs=${encodeURIComponent(cid)}`
            return (
              <iframe
                src={sessionUrl}
                class="flex-1 w-full border-0 bg-zinc-950"
                title="Collab session"
                // Hide the iframe while the Invite modal is open — iframes
                // can render in their own composited layer that ignores the
                // parent's stacking context, so even a z-index:99999 modal
                // can have iframe content bleed through.  Hiding outright
                // sidesteps the problem entirely.
                style={`flex: 1; width: 100%; height: 100%; display: block; ${showInvite() ? "visibility: hidden;" : ""}`}
              />
            )
          }}
            </Show>
          }
        >
          <WorkspaceFailedPanel />
        </Show>
        </Show>
      </div>

      {/* Invite dialog */}
      <Show when={showInvite()}>
        <InviteDialog onClose={() => setShowInvite(false)} />
      </Show>
    </div>
  )
}

// ── Preparing-workspace placeholder ───────────────────────────────────────────
//
// Rendered while the server clones repos + checks out the collab branch +
// pre-warms the native opencode session.  See the comment above the iframe
// `<Show>` in CollabSessionInner for the reasoning.
//
// Two phases:
//   1. First 4 minutes — friendly rotating-status copy + animated icons.
//      Big monorepos with submodules + a cold plugin cache can legitimately
//      take a few minutes; the previous 30s timeout was rushing users into
//      a "stalled" message before the server was actually done.
//   2. After 4 minutes — assumes preWarm has truly stalled; shows a
//      "still cooking" panel with a refresh link.  A reload re-triggers
//      the SPA's data fetch + SSE handshake and the iframe remounts
//      cleanly against whatever state the server has reached.

const PREPARING_TIMEOUT_MS = 4 * 60 * 1000

/** Friendly rotating-status messages.  Cycles every ~3.5s while we wait so
 *  the user has something to read and feels progress is happening even
 *  though we have no real progress signal from the server. */
const PREPARING_TIPS: ReadonlyArray<string> = [
  "Cloning your repositories…",
  "Checking out the collab branch…",
  "Installing the prepare-commit-msg hook…",
  "Warming up the editor…",
  "Bootstrapping the LLM session…",
  "Almost there — hang tight 🙂",
  "Brewing a fresh workspace for your team ☕",
  "Polishing the file tree…",
  "Tuning the typing indicators…",
  "Setting up the prompt queue…",
] as const

function PreparingWorkspacePanel() {
  const [stalled, setStalled] = createSignal(false)
  const [tipIndex, setTipIndex] = createSignal(0)

  // Stalled fallback timer.  Lifetime-tied to the component so navigating
  // away cleans up automatically.
  createEffect(() => {
    const handle = setTimeout(() => setStalled(true), PREPARING_TIMEOUT_MS)
    onCleanup(() => clearTimeout(handle))
  })

  // Rotate the status tip every 3.5s while we're in the patient phase.
  createEffect(() => {
    if (stalled()) return
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % PREPARING_TIPS.length)
    }, 3500)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <div class="flex-1 flex flex-col items-center justify-center text-center bg-zinc-950 px-6">
      {/* Friendly animated icon: a pulsing ring with three orbiting dots.
          Pure CSS animations + a single SVG so this still renders on the
          slowest network without a JS framework hop. */}
      <div class="relative w-20 h-20 mb-6 flex items-center justify-center">
        {/* Outer pulse — slow breathing halo */}
        <div
          class="absolute inset-0 rounded-full bg-blue-500/10 animate-ping"
          style={{ "animation-duration": "2.4s" }}
        />
        {/* Inner ring — solid base */}
        <div class="absolute inset-2 rounded-full bg-zinc-800/70 border border-zinc-700/60" />
        {/* Spinning gradient arc */}
        <svg
          class="absolute inset-0 w-full h-full text-blue-400 animate-spin"
          style={{ "animation-duration": "2s" }}
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
          <path
            class="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        {/* Center emoji — handcrafted little mascot */}
        <span
          class="relative text-2xl"
          style={{ animation: "bounce 1.6s ease-in-out infinite" }}
          aria-hidden="true"
        >
          🛠️
        </span>
      </div>

      <Show
        when={!stalled()}
        fallback={
          <>
            <p class="text-sm font-medium text-zinc-300 mb-1">
              Still cooking…
            </p>
            <p class="text-xs text-zinc-500 mb-4 max-w-sm">
              Your workspace is taking longer than usual to come up.  This can
              happen with very large repos or on a cold worker.  If you'd
              rather not wait any more, refresh to reconnect — your session
              and chat history are safe on the server.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              class="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
            >
              Refresh
            </button>
          </>
        }
      >
        <p class="text-sm font-medium text-zinc-300 mb-2">
          Preparing your collab session
        </p>

        {/* Rotating tip — fades in/out via key swap so each message gets
            a soft fade rather than a hard cut.  The `key={...}` forces
            Solid to re-mount this node when the index changes, which
            re-triggers the CSS animation. */}
        <p
          class="text-xs text-zinc-400 max-w-sm h-4 transition-opacity"
          style={{ animation: "fadeIn 0.6s ease-out" }}
          aria-live="polite"
        >
          {PREPARING_TIPS[tipIndex()]}
        </p>

        <p class="text-[11px] text-zinc-600 mt-4 max-w-sm leading-relaxed">
          This usually takes <span class="text-zinc-400">30 seconds to a few minutes</span> —
          we're cloning repos, checking out the branch, and warming up the
          editor.  Be patient ✨
        </p>

        {/* Bouncing dots — secondary "we're alive" signal in case the tip
            text feels static. */}
        <div class="mt-5 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400/80" style={{ animation: "bounce 1.4s ease-in-out -0.32s infinite" }} />
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400/80" style={{ animation: "bounce 1.4s ease-in-out -0.16s infinite" }} />
          <span class="w-1.5 h-1.5 rounded-full bg-blue-400/80" style={{ animation: "bounce 1.4s ease-in-out 0s infinite" }} />
        </div>
      </Show>

      {/* Local keyframes — kept here so this component is self-contained
          and doesn't depend on Tailwind's JIT picking up `animate-bounce`
          elsewhere in the build.  Tailwind ships these globally but only
          when the matching utility class is referenced somewhere; we use
          inline `animation: bounce ...` so we declare the keyframes here. */}
      <style>{`
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(2px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(-15%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
          50%      { transform: translateY(0);    animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
        }
      `}</style>
    </div>
  )
}

// ── Workspace-init-failed recovery panel ──────────────────────────────────────
//
// Renders when the server-side workspace init (clone + branch checkout)
// failed.  The collab session row still exists; only the workspace clone is
// broken.  A Driver can hit "Retry initialization" to POST /collab/session/:id/reinit,
// which wipes /var/opencode/workspaces/<id>/ on the server and re-runs the
// clone.  Non-Drivers see the failure reason and are told to wait.

function WorkspaceFailedPanel() {
  const collab = useCollab()
  const isDriver = () => collab.viewerRole() === "driver"
  const [retrying, setRetrying] = createSignal(false)
  const [retryErr, setRetryErr] = createSignal<string | null>(null)

  async function retry() {
    if (retrying()) return
    setRetrying(true)
    setRetryErr(null)
    try {
      await collab.reinitWorkspace()
      // The optimistic flip to "pending" in reinitWorkspace() already swapped
      // this panel out for the PreparingWorkspacePanel.  Server will broadcast
      // workspace_ready / workspace_failed when it's done.
    } catch (err) {
      setRetryErr(err instanceof Error ? err.message : String(err))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div class="flex-1 flex flex-col items-center justify-center text-center bg-zinc-950 px-6">
      {/* Warning-style icon: red exclamation in a tinted circle */}
      <div class="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-5">
        <svg
          class="w-8 h-8 text-red-400"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008m6.992-7.5a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      <p class="text-sm font-medium text-zinc-200 mb-1">
        Workspace setup failed
      </p>

      <p class="text-xs text-zinc-500 max-w-md mb-3">
        The server couldn't finish preparing this session's workspace.  Most
        often this is a transient git or network issue; a retry usually
        clears it.
      </p>

      <Show when={collab.session()?.initError}>
        <pre class="text-[11px] text-red-300/80 bg-red-500/5 border border-red-500/20 rounded px-3 py-2 mb-4 max-w-md overflow-x-auto whitespace-pre-wrap">
          {collab.session()!.initError}
        </pre>
      </Show>

      <Show
        when={isDriver()}
        fallback={
          <p class="text-[11px] text-zinc-600 max-w-sm">
            Only a Driver can retry workspace setup.  Hang tight while someone
            with Driver access kicks it off.
          </p>
        }
      >
        <button
          type="button"
          onClick={retry}
          disabled={retrying()}
          class="text-xs px-4 py-2 rounded-md bg-blue-600/20 border border-blue-500/40 text-blue-200 hover:bg-blue-600/30 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {retrying() ? "Retrying…" : "Retry initialization"}
        </button>

        <Show when={retryErr()}>
          <p class="mt-2 text-[11px] text-red-400">{retryErr()}</p>
        </Show>

        <p class="text-[11px] text-zinc-600 mt-3 max-w-sm">
          Retry wipes the server-side workspace and re-runs the shallow clone
          + branch checkout.  Your session, prompts, and chat history are
          unaffected.
        </p>
      </Show>
    </div>
  )
}

// ── Empty-repos fallback panel ────────────────────────────────────────────────
//
// Renders in place of the iframe when the collab session has no linked repos.
// Server side enforces the same gate (cookie-auth iframe rule); this panel
// is the in-UI recovery path so a Driver can fix it without deleting and
// re-creating the session.

interface FallbackRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

function EmptyReposPanel() {
  const collab = useCollab()
  const isDriver = () => collab.viewerRole() === "driver"

  const [repos] = createResource<FallbackRepo[]>(async () => {
    const res = await fetch("/collab/repos")
    if (!res.ok) return []
    return res.json()
  })
  const [selected, setSelected] = createSignal<string[]>([])
  const [adding, setAdding] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)

  function toggle(repoFullName: string) {
    setSelected((prev) =>
      prev.includes(repoFullName) ? prev.filter((r) => r !== repoFullName) : [...prev, repoFullName],
    )
  }

  async function submit() {
    if (selected().length === 0) return
    setErr(null)
    setAdding(true)
    try {
      await collab.addRepos(selected())
      setSelected([])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div class="flex-1 flex flex-col items-center justify-center bg-zinc-950 p-8 overflow-auto">
      <div class="max-w-2xl w-full">
        <div class="text-center mb-6">
          <div class="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <h2 class="text-lg font-semibold text-zinc-200">No repositories linked</h2>
          <p class="text-sm text-zinc-400 mt-1">
            <Show when={isDriver()} fallback="A Driver of this session needs to add a repository before the workspace can open.">
              Pick at least one repository to add to this collab session. The workspace and iframe open once it's cloned.
            </Show>
          </p>
        </div>

        <Show when={isDriver()}>
          <Show
            when={repos()?.length}
            fallback={<div class="text-sm text-zinc-500 text-center">Loading repositories…</div>}
          >
            <div class="max-h-96 overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/40">
              <For each={repos() ?? []}>
                {(repo) => (
                  <label class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-zinc-800/40">
                    <input
                      type="checkbox"
                      class="mt-1"
                      checked={selected().includes(repo.full_name)}
                      onChange={() => toggle(repo.full_name)}
                    />
                    <span class="flex-1 min-w-0">
                      <span class="text-sm text-zinc-200 truncate block">{repo.full_name}</span>
                      <Show when={repo.description}>
                        <span class="text-xs text-zinc-500 line-clamp-1">{repo.description}</span>
                      </Show>
                    </span>
                  </label>
                )}
              </For>
            </div>

            <Show when={err()}>
              <div class="text-xs text-red-400 mt-2">{err()}</div>
            </Show>

            <div class="flex justify-end gap-2 mt-4">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                disabled={selected().length === 0 || adding()}
                onClick={submit}
              >
                {adding() ? "Adding…" : `Add ${selected().length} repo${selected().length === 1 ? "" : "s"}`}
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function CollabSessionPage() {
  const params = useParams<{ id: string }>()
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
        <CollabProvider collabSessionId={params.id} meGithubId={meVal().githubId}>
          <CollabSessionInner me={meVal()} />
        </CollabProvider>
      )}
    </Show>
  )
}
