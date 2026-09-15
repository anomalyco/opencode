import { createMemo, For, Show, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSubAgents } from "@/context/sub-agents"
import { useSessionLayout } from "@/pages/session/session-layout"
import { sessionHref, requireServerKey } from "@/utils/session-route"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import type { SessionStatus, ToolPart } from "@opencode-ai/sdk/v2/client"
import { createSessionContextFormatter } from "./session-context-format"

const COLLAPSE_THRESHOLD = 5

type DerivedStatus = SessionStatus["type"] | "cancelled" | "completed" | "error"

function AgentStatusIcon(props: { status: DerivedStatus }) {
  return (
    <Show
      when={props.status === "busy"}
      fallback={
        <Icon
          name="subagent"
          size="small"
          classList={{
            "shrink-0": true,
            "text-v2-state-fg-danger": props.status === "cancelled" || props.status === "error",
          }}
        />
      }
    >
      <SessionProgressIndicatorV2 class="size-3.5 shrink-0" />
    </Show>
  )
}

function statusLabel(status: DerivedStatus, t: (key: string) => string): string {
  if (status === "busy") return t("session.agents.status.busy")
  if (status === "retry") return t("session.agents.status.retry")
  if (status === "cancelled") return t("session.agents.status.cancelled")
  if (status === "completed") return t("session.agents.status.completed")
  if (status === "error") return t("session.agents.status.error")
  return t("session.agents.status.idle")
}

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Ported from the CLI footer's subagent reader, the authoritative source for a subagent's terminal
// state: packages/opencode/src/cli/cmd/run/subagent-data.ts:125-132,291-331.
export type TaskStatus = "running" | "completed" | "cancelled" | "error"

export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}

// `part.state.metadata` and `part.metadata` are separate carriers, and a pending state has neither.
export function taskMetadata(part: ToolPart, key: string) {
  return ("metadata" in part.state ? part.state.metadata?.[key] : undefined) ?? part.metadata?.[key]
}

export function taskSessionID(part: ToolPart) {
  return text(taskMetadata(part, "sessionId")) ?? text(taskMetadata(part, "sessionID"))
}

export function taskStatus(part: ToolPart): TaskStatus {
  if (part.state.status === "completed") {
    // A `task` tool that swallows the abort finalizes a normal successful result, so the cancellation
    // survives only as the first line of the free-text output.
    const firstLine = text(part.state.output)?.split("\n")[0]?.trim() ?? ""
    if (firstLine === "Aborted" || firstLine.startsWith("Task aborted")) return "cancelled"
    return "completed"
  }

  if (part.state.status === "error") {
    // Cancellation is never a wire status, only a refinement of `error`.
    const interrupted = taskMetadata(part, "interrupted") === true
    if (interrupted || text(part.state.error) === "Tool execution aborted") return "cancelled"
    return "error"
  }

  // `pending` and `running` both fall through here - there is no separate pending bucket.
  return "running"
}

export function SessionAgentsTab() {
  const sync = useSync()
  const language = useLanguage()
  const navigate = useNavigate()
  const { params } = useSessionLayout()
  const { children, totalCost } = useSubAgents()
  const [expanded, setExpanded] = createSignal(false)

  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const visibleChildren = createMemo(() => {
    const list = children()
    if (expanded() || list.length <= COLLAPSE_THRESHOLD) return list
    return list.slice(0, COLLAPSE_THRESHOLD)
  })

  const hasMore = createMemo(() => children().length > COLLAPSE_THRESHOLD && !expanded())

  // The parent session's task tool parts are the only authoritative source for a child's terminal
  // state, and they are already live in the store, so this joins without issuing any request.
  const taskParts = createMemo(() => {
    const parentID = params.id
    if (!parentID) return new Map<string, ToolPart>()
    const parts = (sync().data.message[parentID] ?? []).flatMap((message) => sync().data.part[message.id] ?? [])
    return new Map(
      parts
        .filter((part): part is ToolPart => part.type === "tool" && part.tool === "task")
        // A pending task part carries no metadata yet, so it has no child sessionID to join on.
        .flatMap((part) => {
          const childID = taskSessionID(part)
          return childID ? [[childID, part] as const] : []
        }),
    )
  })

  const deriveStatus = (sessionID: string): DerivedStatus => {
    const task = taskParts().get(sessionID)
    const derived = task ? taskStatus(task) : undefined
    if (derived && derived !== "running") return derived
    const status = sync().data.session_status[sessionID]
    if (status?.type === "busy") return "busy"
    if (status?.type === "retry") return "retry"
    return "idle"
  }

  const navigateToSession = (sessionID: string) => {
    const serverKey = params.serverKey
    if (!serverKey) return
    navigate(sessionHref(requireServerKey(serverKey), sessionID))
  }

  return (
    <ScrollView class="h-full">
      <div class="px-6 pt-4 pb-10 flex flex-col gap-6">
        <Show
          when={children().length > 0}
          fallback={<div class="text-12-regular text-text-weak">{language.t("session.agents.empty")}</div>}
        >
          <div class="flex flex-col gap-1">
            <div class="text-12-regular text-text-weak">{language.t("session.agents.costTotal")}</div>
            <div class="text-12-medium text-text-strong">{formatter().cost(totalCost())}</div>
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-12-regular text-text-weak">
              {language.t("session.agents.costSubagents")} ({children().length})
            </div>

            <div class="flex flex-col gap-1">
              <For each={visibleChildren()}>
                {(session) => {
                  const status = createMemo(() => deriveStatus(session.id))
                  const tokenTotal = createMemo(() => {
                    const tokens = session.tokens
                    return tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read : 0
                  })
                  const tokenLabel = createMemo(() => formatter().tokens(tokenTotal()))
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-3 w-full rounded-md px-3 py-2 text-left hover:bg-surface-hover hover:cursor-pointer transition-colors"
                      onClick={() => navigateToSession(session.id)}
                    >
                      <AgentStatusIcon status={status()} />
                      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div class="flex items-start justify-between gap-2">
                          <span class="text-12-medium text-text-strong truncate min-w-0">
                            {session.title || session.id}
                          </span>
                          <Show when={session.model}>
                            {(model) => (
                              <span class="text-12-regular text-text-weak shrink-0 truncate max-w-full ml-2">
                                {model().providerID}/{model().id}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="text-12-regular text-text-weak flex justify-between gap-2">
                          <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span>{statusLabel(status(), language.t)}</span>
                            <Show when={tokenTotal() > 0}>
                              <span class="text-text-faint">·</span>
                              <span class="text-text-faint">
                                {tokenLabel()} {language.t("session.agents.tokens")}
                              </span>
                            </Show>
                            <span class="text-text-faint">·</span>
                            <span class="text-text-faint">
                              {formatTime(session.time.created, language.intl())}
                              <Show when={session.time.updated > session.time.created + 60_000}>
                                {" → "}
                                {formatTime(session.time.updated, language.intl())}
                              </Show>
                            </span>
                          </div>
                          <Show when={session.cost != null}>
                            <span class="text-12-regular text-text-weak whitespace-nowrap">
                              {formatter().cost(session.cost ?? 0)}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </button>
                  )
                }}
              </For>
            </div>

            <Show when={hasMore()}>
              <button
                type="button"
                class="text-12-regular text-text-weak hover:text-text-strong transition-colors text-left px-3 py-1"
                onClick={() => setExpanded(true)}
              >
                {language.t("session.agents.showAll", { count: children().length })}
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </ScrollView>
  )
}
