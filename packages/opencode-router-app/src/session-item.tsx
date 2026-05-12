import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context"
import { Portal } from "solid-js/web"
import type { Session, StoredMessage } from "./api"
import { subscribeProgressStream } from "./api"
import { useT } from "./i18n"
import { StatusDot } from "./status-dot"
import { computeIdleStatus } from "./session-utils"

export function computeRelativeAge(lastActivity: string) {
  const diffMs = Date.now() - new Date(lastActivity).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function stripRepoUrl(repoUrl: string) {
  return repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
}

/**
 * Human-readable repo label for a session:
 * - Always strips the server (e.g. "github.com")
 * - Strips the owner segment when it matches the email username (part before "@")
 */
export function repoLabel(repoUrl: string, email: string) {
  const stripped = stripRepoUrl(repoUrl)
  const parts = stripped.split("/")
  const withoutServer = parts.slice(1) // ["owner", "repo"]
  const username = email.split("@")[0] ?? ""
  if (username && withoutServer[0]?.toLowerCase() === username.toLowerCase()) {
    return withoutServer.slice(1).join("/") || withoutServer.join("/")
  }
  return withoutServer.join("/")
}

type Props = {
  session: Session
  /** compact = sidebar variant */
  compact?: boolean
  active?: boolean
  onClick?: () => void
  trailing?: any
  /** full variant only: whether detail panel is expanded */
  expanded?: boolean
  /** full variant only: called when `…` button is clicked */
  onToggleExpand?: () => void
  /** full variant only: called when the terminate button in the detail panel is clicked */
  onTerminate?: () => void
}

export function SessionItem(props: Props) {
  const t = useT(useI18n())
  const repo = () => stripRepoUrl(props.session.repoUrl)
  const name = () => repoLabel(props.session.repoUrl, props.session.email)
  const created = () => computeRelativeAge(props.session.createdAt)
  const clickable = () => props.session.state !== "creating"

  const idle = () =>
    computeIdleStatus(props.session.state, props.session.lastActivity, props.session.idleTimeoutMinutes, {
      stopsIn: (m) => t("session.idle.stopsIn", { minutes: m }),
      stoppedOn: (d) => t("session.idle.stoppedOn", { date: d }),
      stoppingSoon: t("session.idle.stoppingSoon"),
    })

  /** Second line for compact variant */
  const compactMeta = () =>
    props.session.state === "stopped" ? `stopped ${formatDate(props.session.lastActivity)}` : `started ${created()}`

  // Live message thread from /progress/stream — opened when panel is expanded
  const [messages, setMessages] = createSignal<StoredMessage[]>([])
  const [attachCopied, setAttachCopied] = createSignal(false)

  const attachCommand = () => {
    const url = props.session.attachUrl
    const password = props.session.attachPassword
    if (!url || !password) return null
    const sessionId = props.session.url?.split("/session/")[1] ?? null
    return sessionId
      ? `opencode attach ${url} --password ${password} -s ${sessionId}`
      : `opencode attach ${url} --password ${password}`
  }

  const copyAttachCommand = () => {
    const cmd = attachCommand()
    if (!cmd) return
    navigator.clipboard.writeText(cmd)
    setAttachCopied(true)
    setTimeout(() => setAttachCopied(false), 2000)
  }

  createEffect(() => {
    if (!props.expanded) {
      setMessages([])
      return
    }
    const es = subscribeProgressStream(props.session.hash, {
      onSnapshot: (progress) => setMessages(progress.messages),
      onMessage: (msg) =>
        setMessages((prev) => {
          // dedup by partID (router does it too, but be defensive client-side)
          if (prev.some((m) => m.partID === msg.partID)) return prev
          return [...prev, msg]
        }),
    })
    onCleanup(() => es.close())
  })

  return (
    <Show
      when={props.compact}
      fallback={
        /* ── FULL (main list) variant ── */
        <div class="flex flex-col">
          {/* Row */}
          <div
            class="flex items-center gap-3 px-4 py-3 group"
            style={{
              cursor: clickable() ? "pointer" : "default",
              background: props.active ? "var(--background-highlight)" : undefined,
            }}
            onClick={() => clickable() && props.onClick?.()}
          >
            {/* Status dot — far left */}
            <div class="shrink-0 self-start mt-1">
              <StatusDot state={props.session.state} />
            </div>

            {/* Left: repo + message */}
            <div class="flex flex-col flex-1 min-w-0">
              <p class="text-13-medium truncate" style={{ color: "var(--text-base)" }}>
                {repo()}
              </p>
              <Show when={props.session.title}>
                <p class="text-12-medium truncate" style={{ color: "var(--text-base)" }}>
                  {props.session.title}
                </p>
              </Show>
              <Show when={props.session.description}>
                <p class="text-12-regular truncate" style={{ color: "var(--text-dimmed-base)" }}>
                  {props.session.description}
                </p>
              </Show>
            </div>

            {/* `…` expand button — far right, stops propagation */}
            <button
              class="shrink-0 self-start mt-0.5 flex items-center justify-center w-7 h-7 rounded text-13-regular"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: props.expanded ? "var(--text-base)" : "var(--text-dimmed-base)",
              }}
              onClick={(e) => {
                e.stopPropagation()
                props.onToggleExpand?.()
              }}
              aria-label="Session details"
              aria-expanded={props.expanded}
            >
              …
            </button>

            {props.trailing}
          </div>

          {/* Inline detail panel — always in DOM for CSS transition */}
          <div
            style={{
              overflow: "hidden",
              "max-height": props.expanded ? "300px" : "0",
              transition: "max-height 200ms ease",
            }}
          >
            <div class="flex flex-col gap-3 px-4 pb-4 pt-1" style={{ "border-top": "1px solid var(--border-base)" }}>
              {/* Title (shown when no description) */}
              <Show when={props.session.title && !props.session.description}>
                <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                  {props.session.title}
                </p>
              </Show>

              {/* Full description */}
              <Show when={props.session.description}>
                <p
                  class="text-12-regular"
                  style={{ color: "var(--text-dimmed-base)", "word-break": "break-word", "white-space": "pre-wrap" }}
                >
                  {props.session.description}
                </p>
              </Show>

              {/* Live message thread from /progress/stream */}
              <Show when={messages().length > 0}>
                <div
                  class="flex flex-col gap-1 max-h-40 overflow-y-auto"
                  style={{ "border-top": "1px solid var(--border-base)", "padding-top": "8px" }}
                >
                  <For each={messages()}>
                    {(msg) => (
                      <div
                        class="text-11-regular"
                        style={{
                          color: msg.role === "user" ? "var(--text-base)" : "var(--text-dimmed-base)",
                          "text-align": msg.role === "user" ? "right" : "left",
                          "word-break": "break-word",
                          "white-space": "pre-wrap",
                        }}
                      >
                        {msg.text}
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Created + idle status */}
              <p class="text-11-regular" style={{ color: "var(--text-dimmed-base)" }}>
                Created {created()} · {idle().label}
              </p>

              {/* Action buttons */}
              <div class="flex gap-2">
                <Show when={attachCommand()}>
                  <button
                    class="text-13-medium rounded-lg flex-1"
                    style={{
                      background: "none",
                      border: "1px solid var(--border-base)",
                      cursor: "pointer",
                      color: attachCopied() ? "var(--text-success-base, #22c55e)" : "var(--text-base)",
                      "min-height": "44px",
                      padding: "10px 16px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      copyAttachCommand()
                    }}
                  >
                    {attachCopied() ? t("session.action.attachCopied") : t("session.action.attach")}
                  </button>
                </Show>
                <button
                  class="text-13-medium rounded-lg flex-1"
                  style={{
                    background: "none",
                    border: "1px solid var(--border-base)",
                    cursor: "pointer",
                    color: "var(--text-danger-base, #ef4444)",
                    "min-height": "44px",
                    padding: "10px 16px",
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onTerminate?.()
                  }}
                >
                  {t("session.action.terminate")}
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <CompactSessionItem
        session={props.session}
        name={name()}
        compactMeta={compactMeta()}
        active={props.active}
        clickable={clickable()}
        trailing={props.trailing}
        onClick={props.onClick}
      />
    </Show>
  )
}

/** Separate component so it can have its own hover state signals */
function CompactSessionItem(props: {
  session: Session
  name: string
  compactMeta: string
  active?: boolean
  clickable: boolean
  trailing?: any
  onClick?: () => void
}) {
  const [tooltipPos, setTooltipPos] = createSignal<{ top: number; left: number } | null>(null)
  let rowRef: HTMLDivElement | undefined

  const showTooltip = () => {
    if (!rowRef || !props.session.description) return
    const rect = rowRef.getBoundingClientRect()
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 8 })
  }

  const hideTooltip = () => setTooltipPos(null)

  return (
    <div
      ref={rowRef}
      class="flex items-center gap-2 px-2 py-1.5 rounded-md"
      style={{
        cursor: props.clickable ? "pointer" : "default",
        background: props.active ? "var(--background-highlight)" : undefined,
      }}
      onClick={() => props.clickable && props.onClick?.()}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      <StatusDot state={props.session.state} />

      <div class="flex flex-col flex-1 min-w-0">
        <p class="text-12-regular truncate" style={{ color: "var(--text-base)" }}>
          {props.name}
        </p>
        <p class="text-11-regular truncate" style={{ color: "var(--text-dimmed-base)" }}>
          {props.compactMeta}
        </p>
      </div>

      {props.trailing}

      {/* Fixed-position tooltip rendered into document.body to escape overflow:hidden parents */}
      <Show when={tooltipPos() !== null && props.session.description}>
        <Portal>
          <div
            class="pointer-events-none fixed z-[9999] text-12-regular rounded-lg px-3 py-2 max-w-64 shadow-lg"
            style={{
              top: `${tooltipPos()!.top}px`,
              left: `${tooltipPos()!.left}px`,
              transform: "translateY(-50%)",
              background: "var(--surface-float-base)",
              color: "var(--text-invert-base)",
              border: "none",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {props.session.description}
          </div>
        </Portal>
      </Show>
    </div>
  )
}
