import { createMemo, For, Show, createSignal, createEffect, onCleanup } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { sessionHref, requireServerKey } from "@/utils/session-route"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"

const COLLAPSE_THRESHOLD = 5

function AgentStatusIcon(props: { status: DerivedStatus }) {
  return (
    <Show
      when={props.status === "busy"}
      fallback={<Icon name="subagent" size="small" classList={{ "shrink-0": true, "text-v2-state-fg-danger": props.status === "cancelled" }} />}
    >
      <SessionProgressIndicatorV2 class="size-3.5 shrink-0" />
    </Show>
  )
}

type DerivedStatus = SessionStatus["type"] | "cancelled"

function statusLabel(status: DerivedStatus, t: (key: string) => string): string {
  if (status === "busy") return t("session.agents.status.busy")
  if (status === "retry") return t("session.agents.status.retry")
  if (status === "cancelled") return t("session.agents.status.cancelled")
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

export function SessionAgentsTab() {
  const sync = useSync()
  const language = useLanguage()
  const navigate = useNavigate()
  const { params } = useSessionLayout()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = createSignal(false)

  const childSessionsQuery = useQuery(() => ({
    queryKey: [serverSDK().scope, sdk().directory, "childSessions", params.id] as const,
    queryFn: async (): Promise<Session[]> => {
      const id = params.id
      if (!id) return []
      const response = await sdk().client.session.list()
      return (response.data ?? []).filter((s) => s.parentID === id) as Session[]
    },
    enabled: !!params.id,
    staleTime: 5_000,
    refetchOnReconnect: true,
  }))

  const children = createMemo(() => childSessionsQuery.data ?? ([] as Session[]))

  const cancelledQuery = useQuery(() => ({
    queryKey: [serverSDK().scope, sdk().directory, "childCancelled", params.id, children().length] as const,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const sessions = children()
      const entries = await Promise.all(sessions.map(async (s) => {
        const resp = await sdk().client.session.messages({ sessionID: s.id, limit: 1 }).catch(() => ({ data: [] }))
        const msgs = resp.data ?? []
        const lastMsg = msgs[msgs.length - 1]
        return [s.id, lastMsg?.info?.error?.name === "MessageAbortedError"] as const
      }))
      return Object.fromEntries(entries)
    },
    enabled: () => children().length > 0,
    staleTime: 10_000,
  }))

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    // Track statuses and sessions reactively, same as hasBusyChildren in message-timeline
    const statuses = sync().data.session_status
    const sessions = sync().data.session ?? []
    // Track each child's status entry reactively (busy, idle, or removed)
    const hasBusy = sessions.some(
      (s) => s.parentID === sessionID && statuses[s.id]?.type === "busy",
    )
    // Always invalidate when tracked data changes (start, status change, or completion)
    void queryClient.invalidateQueries({
      queryKey: [serverSDK().scope, sdk().directory, "childSessions", sessionID],
      exact: true,
    })
  })

  const totalCost = createMemo(() => {
    const parent = params.id ? sync().session.get(params.id) : undefined
    const parentCost = parent?.cost ?? 0
    const childCost = children().reduce((sum, s) => sum + (s.cost ?? 0), 0)
    return parentCost + childCost
  })

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const visibleChildren = createMemo(() => {
    const list = children()
    if (expanded() || list.length <= COLLAPSE_THRESHOLD) return list
    return list.slice(0, COLLAPSE_THRESHOLD)
  })

  const hasMore = createMemo(() => children().length > COLLAPSE_THRESHOLD && !expanded())

  const deriveStatus = (sessionID: string): DerivedStatus => {
    const status = sync().data.session_status[sessionID]
    if (status?.type === "busy") return "busy"
    if (status?.type === "retry") return "retry"
    if (cancelledQuery.data?.[sessionID]) return "cancelled"
    return "idle"
  }

  const navigateToSession = async (sessionID: string) => {
    const serverKey = params.serverKey
    if (!serverKey) return
    const resp = await sdk().client.session.get({ sessionID }).catch(() => null)
    if (!resp) return
    navigate(sessionHref(requireServerKey(serverKey), sessionID))
  }

  return (
    <ScrollView class="h-full">
      <div class="px-6 pt-4 pb-10 flex flex-col gap-6">
        <Show when={children().length > 0} fallback={<div class="text-12-regular text-text-weak">{language.t("session.agents.empty")}</div>}>
          <div class="flex flex-col gap-1">
            <div class="text-12-regular text-text-weak">{language.t("session.agents.costTotal")}</div>
            <div class="text-12-medium text-text-strong">{usd().format(totalCost())}</div>
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-12-regular text-text-weak">
              {language.t("session.agents.costSubagents")} ({children().length})
            </div>

            <div class="flex flex-col gap-1">
              <For each={visibleChildren()}>
                {(session) => {
                  const st = deriveStatus(session.id)
                  const t = session.tokens
                  const totalT = t ? t.input + t.output + t.reasoning + t.cache.read : 0
                  const fmtTokens = totalT < 1000 ? String(totalT) : totalT < 1_000_000 ? `${(totalT / 1000).toFixed(totalT < 10_000 ? 1 : 0)}k` : `${(totalT / 1_000_000).toFixed(1)}M`
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-3 w-full rounded-md px-3 py-2 text-left hover:bg-surface-hover hover:cursor-pointer transition-colors"
                      onClick={(e) => { e.preventDefault(); navigateToSession(session.id) }}
                    >
                      <AgentStatusIcon status={st} />
                      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div class="flex items-start justify-between gap-2">
                          <span class="text-12-medium text-text-strong truncate min-w-0">{session.title || session.id}</span>
                          <Show when={session.model}>
                            <span class="text-12-regular text-text-weak shrink-0 truncate max-w-full ml-2">{session.model!.providerID}/{session.model!.id}</span>
                          </Show>
                        </div>
                        <div class="text-12-regular text-text-weak flex justify-between gap-2">
                          <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span>{statusLabel(st, language.t)}</span>
                            <Show when={totalT > 0}>
                              <span class="text-text-faint">·</span>
                              <span class="text-text-faint">{fmtTokens} tokens</span>
                            </Show>
                            <span class="text-text-faint">·</span>
                            <span class="text-text-faint">
                              {formatTime(session.time.created, language.intl())}
                              <Show when={session.time.updated > session.time.created + 60_000}>
                                {" → "}{formatTime(session.time.updated, language.intl())}
                              </Show>
                            </span>
                          </div>
                          <Show when={session.cost != null}>
                            <span class="text-12-regular text-text-weak whitespace-nowrap">{usd().format(session.cost)}</span>
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
                Show all ({children().length})
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </ScrollView>
  )
}