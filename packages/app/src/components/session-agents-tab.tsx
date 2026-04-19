import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Tag } from "@opencode-ai/ui/tag"
import type { Session } from "@opencode-ai/sdk/v2/client"

type WorkerStatus = "running" | "completed" | "error" | "idle"

function getWorkerStatus(session: Session): WorkerStatus {
  if (session.time?.archived) return "completed"
  const updated = session.time?.updated ?? session.time?.created
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
  if (updated && updated > fiveMinutesAgo) return "running"
  return "idle"
}

const AGENT_PALETTE = [
  { bg: "#2d4a3e", fg: "#6ee7b7" },
  { bg: "#3b3a52", fg: "#c4b5fd" },
  { bg: "#4a3728", fg: "#fbbf24" },
  { bg: "#2e3f5c", fg: "#93c5fd" },
  { bg: "#4c2e3e", fg: "#f9a8d4" },
  { bg: "#2e4c49", fg: "#5eead4" },
  { bg: "#5c3a2e", fg: "#fdba74" },
  { bg: "#3e2e4c", fg: "#d8b4fe" },
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getAgentColors(id: string) {
  const idx = hashString(id) % AGENT_PALETTE.length
  return AGENT_PALETTE[idx]
}

function formatTimeAgo(timestamp: number | undefined): string {
  if (!timestamp) return ""
  const diff = Date.now() - timestamp
  if (diff < 60000) return "just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function AgentCard(props: {
  session: Session
  expanded: boolean
  onToggle: () => void
}) {
  const status = createMemo(() => getWorkerStatus(props.session))
  const title = createMemo(() => {
    const t = props.session.title ?? "Worker"
    if (t.startsWith("Child session - ")) return t.slice("Child session - ".length)
    return t
  })

  const initial = createMemo(() => {
    const t = title()
    return t[0]?.toUpperCase() ?? "W"
  })

  const colors = createMemo(() => getAgentColors(props.session.id))

  const ringColor = createMemo(() => {
    switch (status()) {
      case "running":
        return "#60a5fa"
      case "completed":
        return "#22c55e"
      case "error":
        return "#ef4444"
      case "idle":
        return "rgba(107,114,128,0.4)"
    }
  })

  const statusLabel = createMemo(() => {
    switch (status()) {
      case "running":
        return "Running"
      case "completed":
        return "Done"
      case "error":
        return "Error"
      case "idle":
        return "Idle"
    }
  })

  const timeAgo = createMemo(() =>
    formatTimeAgo(props.session.time?.updated ?? props.session.time?.created),
  )

  const isActive = createMemo(() => status() === "running")

  return (
    <div
      class="w-full rounded-lg border border-border-base/50 bg-surface-base/40 transition-colors duration-150 hover:bg-surface-base/70"
    >
      <button
        type="button"
        class="w-full text-left flex items-center gap-3 px-3 py-2.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-text-interactive-base"
        onClick={props.onToggle}
      >
        <div
          class="shrink-0 relative"
          style={{
            width: "42px",
            height: "42px",
            "border-radius": "9999px",
            padding: "2.5px",
            background: isActive()
              ? `conic-gradient(from 0deg, ${ringColor()}, ${ringColor()}88, ${ringColor()})`
              : `linear-gradient(135deg, ${ringColor()}, ${ringColor()})`,
            animation: isActive() ? "agent-spin 2s linear infinite" : "none",
          }}
        >
          <Avatar
            fallback={initial()}
            background={colors().bg}
            foreground={colors().fg}
            style={{
              width: "100%",
              height: "100%",
              "border-radius": "9999px",
              "font-size": "14px",
              "line-height": "37px",
            }}
          />
        </div>

        <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
          <span class="text-12-medium truncate leading-tight">{title()}</span>
          <span class="text-11-regular text-text-weak truncate leading-tight">
            {statusLabel()}
            <Show when={timeAgo()}>
              {(t) => <> · {t()}</>}
            </Show>
          </span>
        </div>

        <Show when={isActive()}>
          <div class="shrink-0 flex items-center gap-1.5">
            <span
              class="inline-block rounded-full"
              style={{
                width: "6px",
                height: "6px",
                background: ringColor(),
                animation: "agent-pulse 1.5s ease-in-out infinite",
              }}
            />
          </div>
        </Show>
      </button>

      <div
        class="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ "grid-template-rows": props.expanded ? "1fr" : "0fr" }}
      >
        <div class="overflow-hidden">
          <div class="px-3 pb-3 pt-1 border-t border-border-base/30">
            <div class="flex flex-col gap-1.5 text-11-regular text-text-weak pt-2">
              <div class="flex justify-between">
                <span>Session</span>
                <span class="text-text-base font-mono" style={{ "font-size": "10px" }}>
                  {props.session.id.slice(0, 20)}
                </span>
              </div>
              <Show when={props.session.time?.created}>
                {(ts) => (
                  <div class="flex justify-between">
                    <span>Created</span>
                    <span>
                      {new Date(ts()).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </Show>
              <Show when={props.session.time?.updated}>
                {(ts) => (
                  <div class="flex justify-between">
                    <span>Last active</span>
                    <span>
                      {new Date(ts()).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </Show>
              <Show when={props.session.summary}>
                {(s) => (
                  <div class="flex justify-between">
                    <span>Changes</span>
                    <span>
                      +{s().additions} / -{s().deletions} ({s().files} files)
                    </span>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type FilterMode = "active" | "all"

export function AgentsTab(props: { parentSessionID?: string }) {
  const language = useLanguage()
  const sync = useSync()
  const { params } = useSessionLayout()
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [filter, setFilter] = createSignal<FilterMode>("active")

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const childSessions = createMemo(() => {
    const syncStore = sync.data
    const sessions = syncStore.session ?? []
    const parentID = props.parentSessionID ?? params.id
    if (!parentID) return []
    return sessions.filter((s) => s.parentID === parentID && !s.time?.archived)
  })

  const runningWorkers = createMemo(() =>
    childSessions().filter((s) => getWorkerStatus(s) === "running"),
  )

  const completedWorkers = createMemo(() =>
    childSessions().filter((s) => getWorkerStatus(s) !== "running"),
  )

  const hasChildren = createMemo(() => childSessions().length > 0)

  const filteredSessions = createMemo(() => {
    if (filter() === "all") return childSessions()
    return runningWorkers()
  })

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="px-3 pt-3 pb-2 flex items-center justify-between">
        <div class="text-13-medium text-text-base">
          {language.t("session.tab.agents", { defaultValue: "Agents" })}
        </div>
        <Show when={runningWorkers().length > 0}>
          <Tag size="normal">{runningWorkers().length}</Tag>
        </Show>
      </div>

      <Show when={hasChildren()}>
        <div class="px-3 pb-2 flex items-center gap-1">
          <button
            type="button"
            classList={{
              "px-2.5 py-0.5 rounded-md text-11-medium transition-colors duration-100": true,
              "bg-text-interactive-base text-text-on-intent": filter() === "active",
              "text-text-weak hover:text-text-base hover:bg-surface-base/60": filter() !== "active",
            }}
            onClick={() => setFilter("active")}
          >
            Active
          </button>
          <button
            type="button"
            classList={{
              "px-2.5 py-0.5 rounded-md text-11-medium transition-colors duration-100": true,
              "bg-text-interactive-base text-text-on-intent": filter() === "all",
              "text-text-weak hover:text-text-base hover:bg-surface-base/60": filter() !== "all",
            }}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
      </Show>

      <Switch>
        <Match when={!hasChildren()}>
          <div class="flex-1 flex items-center justify-center px-6 text-center">
            <div class="text-12-regular text-text-weak">
              {language.t("session.agents.noWorkers", {
                defaultValue:
                  "No active agents. Workers will appear here when a Boss Agent spawns them.",
              })}
            </div>
          </div>
        </Match>

        <Match when={hasChildren()}>
          <div class="flex-1 overflow-y-auto px-2 pb-4">
            <Show when={filteredSessions().length === 0 && filter() === "active"}>
              <div class="px-3 py-4 text-center text-11-regular text-text-weak">
                No active agents
              </div>
            </Show>

            <div class="flex flex-col gap-1.5">
              <For each={filteredSessions()}>
                {(session) => (
                  <AgentCard
                    session={session}
                    expanded={expanded().has(session.id)}
                    onToggle={() => toggle(session.id)}
                  />
                )}
              </For>
            </div>
          </div>
        </Match>
      </Switch>

      <style>{`
        @keyframes agent-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
