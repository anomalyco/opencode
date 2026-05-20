/**
 * Team Notes composer + feed for the collab left panel.
 *
 * A side-channel chat box where participants can ping each other with
 * `@mentions`, separate from the LLM prompt path.  Why this exists:
 * the opencode editor inside the iframe binds `@` to a file/agent
 * picker, so there's no way to cleanly type a user mention there.
 * This composer owns its own textarea and an autocomplete popover that
 * suggests session participants matching the current `@<partial>`
 * token.
 *
 * Submitted notes:
 *   - hit POST /collab/session/:id/note
 *   - broadcast `collab:note_added` (renders in everyone's feed)
 *   - emit `collab:mention` events for any @-mentions matching a real
 *     participant (badge + desktop notification handled in the
 *     CollabProvider)
 */

import { createSignal, createMemo, Show, For, onCleanup } from "solid-js"
import { useCollab } from "@/context/collab"
import type { Participant, CollabNote } from "@opencode-ai/collab"

/** Match the `@<partial>` token at the current caret — only when the
 *  caret is right after a token that has no whitespace between `@` and
 *  the cursor.  Returns null when not in an active mention edit. */
function matchActiveMention(value: string, caret: number): { start: number; partial: string } | null {
  // Walk backwards from caret looking for `@` or whitespace.
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]!
    if (ch === "@") {
      // The `@` must be at start of string OR preceded by whitespace.
      if (i === 0 || /\s/.test(value[i - 1]!)) {
        const partial = value.slice(i + 1, caret)
        // Login chars only — bail if the partial contains anything weird.
        if (/^[A-Za-z0-9-]*$/.test(partial) && partial.length <= 39) {
          return { start: i, partial }
        }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

/** Render content with @-tokens highlighted as inline blue pills. */
function renderMentions(text: string) {
  const RE = /(^|\s)(@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g
  const parts: Array<string | { mention: string }> = []
  let last = 0
  let m: RegExpExecArray | null
  RE.lastIndex = 0
  while ((m = RE.exec(text)) !== null) {
    const start = m.index + m[1]!.length
    if (start > last) parts.push(text.slice(last, start))
    parts.push({ mention: m[2]! })
    last = RE.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
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

function relativeTime(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function TeamNoteComposer(props: {
  /** Hide the composer (Viewer role). */
  readonly?: boolean
}) {
  const collab = useCollab()
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [highlightIdx, setHighlightIdx] = createSignal(0)
  // Collapsed by default keeps the sidebar compact — when notes are
  // important the user expands; the unread count on the header chip is
  // still visible while collapsed so they don't miss new chatter.
  const [expanded, setExpanded] = createSignal(true)
  let textareaRef: HTMLTextAreaElement | undefined
  // Tick re-evaluates the visible relative timestamps every 30s
  const [tick, setTick] = createSignal(0)
  const interval = setInterval(() => setTick((t) => t + 1), 30_000)
  onCleanup(() => clearInterval(interval))

  /** The active @-mention edit at the current caret, if any. */
  const activeMention = createMemo(() => {
    if (!textareaRef) return null
    return matchActiveMention(text(), textareaRef.selectionStart ?? text().length)
  })

  /** Up-to-6 participant suggestions whose login prefix-matches the
   *  active partial.  Sorted online-first so likely targets are at top. */
  const suggestions = createMemo<Participant[]>(() => {
    const active = activeMention()
    if (!active) return []
    const q = active.partial.toLowerCase()
    return collab
      .participants()
      .filter((p) => p.githubLogin.toLowerCase().startsWith(q))
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline))
      .slice(0, 6)
  })

  function insertSuggestion(p: Participant) {
    const active = activeMention()
    if (!active || !textareaRef) return
    const before = text().slice(0, active.start)
    const after = text().slice(textareaRef.selectionStart ?? text().length)
    const insertion = `@${p.githubLogin} `
    const next = before + insertion + after
    setText(next)
    setPopoverOpen(false)
    // Place caret right after the inserted login + trailing space.
    const caret = (before + insertion).length
    queueMicrotask(() => {
      textareaRef!.focus()
      textareaRef!.setSelectionRange(caret, caret)
    })
  }

  function handleKeyDown(e: KeyboardEvent) {
    // ⌘↵ / Ctrl+↵ submits regardless of popover state.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
      return
    }
    if (popoverOpen() && suggestions().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIdx((i) => (i + 1) % suggestions().length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIdx((i) => (i - 1 + suggestions().length) % suggestions().length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const pick = suggestions()[highlightIdx()]
        if (pick) insertSuggestion(pick)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setPopoverOpen(false)
        return
      }
    }
  }

  function handleInput() {
    if (!textareaRef) return
    setText(textareaRef.value)
    const active = matchActiveMention(textareaRef.value, textareaRef.selectionStart ?? 0)
    if (active) {
      setPopoverOpen(true)
      setHighlightIdx(0)
    } else {
      setPopoverOpen(false)
    }
  }

  async function submit() {
    const content = text().trim()
    if (!content || sending()) return
    setSending(true)
    setError(null)
    try {
      await collab.postNote(content)
      setText("")
      setPopoverOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="border-b border-zinc-800/60 flex-shrink-0">
      {/* Collapsible header — clicking the whole bar toggles open/closed.
          Mirrors the Queue header pattern below for visual consistency. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="w-full px-3 py-2 flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-wider font-medium hover:text-zinc-400 transition-colors"
      >
        <span>Team chat</span>
        <div class="flex items-center gap-1.5">
          <Show when={collab.notes().length > 0}>
            <span class="px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] normal-case tracking-normal">
              {collab.notes().length}
            </span>
          </Show>
          <svg
            class={`w-3.5 h-3.5 transition-transform ${expanded() ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <Show when={expanded()}>
        <div class="px-3 pb-2 space-y-2">
          {/* Scrolling notes feed.  Max-height keeps the composer in view; the
              feed scrolls internally if there are many notes. */}
          <NotesFeed notes={collab.notes()} tick={tick()} />

          <Show
            when={!props.readonly}
            fallback={<div class="text-[11px] text-zinc-600 italic">Viewers cannot post notes.</div>}
          >
            <div class="relative">
              <textarea
                ref={(el) => (textareaRef = el)}
                value={text()}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onSelect={handleInput /* keep activeMention() in sync with caret */}
                placeholder="Message the team — @mention to ping ⌘↵ to send"
                rows={2}
                disabled={sending()}
                class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
              />

              {/* Autocomplete popover */}
              <Show when={popoverOpen() && suggestions().length > 0}>
                <div
                  class="absolute left-0 right-0 -top-2 -translate-y-full z-20 rounded border border-zinc-700 bg-zinc-900 shadow-lg overflow-hidden"
                  style={{ "max-height": "200px", "overflow-y": "auto" }}
                >
                  <For each={suggestions()}>
                    {(p, i) => (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          // mousedown not click — click would fire after blur
                          e.preventDefault()
                          insertSuggestion(p)
                        }}
                        onMouseEnter={() => setHighlightIdx(i())}
                        classList={{
                          "w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors": true,
                          "bg-blue-500/20 text-blue-200": i() === highlightIdx(),
                          "hover:bg-zinc-800 text-zinc-300": i() !== highlightIdx(),
                        }}
                      >
                        <img
                          src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=24`}
                          alt=""
                          class="w-4 h-4 rounded-full"
                        />
                        <span class="font-mono">@{p.githubLogin}</span>
                        <Show when={p.isOnline}>
                          <span class="ml-auto w-1.5 h-1.5 rounded-full" style={{ "background-color": "#34d399" }} />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <Show when={error()}>
              <div class="text-[10px] text-red-400">{error()}</div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function NotesFeed(props: { notes: CollabNote[]; tick: number }) {
  let scroller: HTMLDivElement | undefined
  // After every render, auto-scroll to the bottom IF the user was already at
  // (or within 40 px of) the bottom — preserves position when reading older
  // messages.
  let lastCount = 0
  const onAfter = () => {
    if (!scroller) return
    const wasAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40
    if (props.notes.length !== lastCount && (wasAtBottom || lastCount === 0)) {
      scroller.scrollTop = scroller.scrollHeight
    }
    lastCount = props.notes.length
  }

  return (
    <Show
      when={props.notes.length > 0}
      fallback={
        <div class="text-[11px] text-zinc-600 italic px-1">No team messages yet.</div>
      }
    >
      <div
        ref={(el) => {
          scroller = el
          queueMicrotask(onAfter)
        }}
        class="max-h-40 overflow-y-auto space-y-1.5 pr-1"
      >
        <For each={props.notes}>
          {(n) => {
            // Touch tick to re-render relative timestamps periodically.
            props.tick
            return (
              <div class="flex items-start gap-1.5">
                <img
                  src={`https://github.com/${n.authorGithubLogin}.png?size=20`}
                  alt={n.authorGithubLogin}
                  class="w-4 h-4 rounded-full flex-shrink-0 mt-0.5"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-[11px] font-medium text-zinc-300 truncate">{n.authorGithubLogin}</span>
                    <span class="text-[9px] text-zinc-600">{relativeTime(n.createdAt)}</span>
                  </div>
                  <div class="text-[11px] text-zinc-400 whitespace-pre-wrap break-words leading-snug">
                    {renderMentions(n.content)}
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
