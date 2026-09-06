import { For, createMemo, type JSX } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"

type IconName = "magnifying-glass" | "arrow-right" | "circle-ban-sign" | "pencil-line" | "magnifying-glass-menu" | "circle-x" | "circle-check" | "arrow-undo-down"

interface ReasoningLogEntry {
  readonly id: string
  readonly type: "why_loop" | "then_loop" | "pre_action" | "hypothesis_update" | "evi_score" | "counterfactual" | "self_consistency" | "temporal_guard"
  readonly content: string
  readonly metadata: Record<string, unknown>
  readonly timestamp: string
}

export function SessionReasoningPanel() {
  const sync = useServerSync()
  const { params } = useSessionLayout()
  const language = useLanguage()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const reasoningLog = createMemo(() => {
    const session = info()
    if (!session) return [] as ReasoningLogEntry[]
    return (session.metadata?.reasoningLog ?? []) as ReasoningLogEntry[]
  })

  const getTypeLabel = (type: ReasoningLogEntry["type"]) => {
    switch (type) {
      case "why_loop":
        return language.t("session.reasoning.type.whyLoop")
      case "then_loop":
        return language.t("session.reasoning.type.thenLoop")
      case "pre_action":
        return language.t("session.reasoning.type.preAction")
      case "hypothesis_update":
        return language.t("session.reasoning.type.hypothesisUpdate")
      case "evi_score":
        return language.t("session.reasoning.type.eviScore")
      case "counterfactual":
        return language.t("session.reasoning.type.counterfactual")
      case "self_consistency":
        return language.t("session.reasoning.type.selfConsistency")
      case "temporal_guard":
        return language.t("session.reasoning.type.temporalGuard")
    }
  }

  const getTypeIcon = (type: ReasoningLogEntry["type"]): IconName => {
    switch (type) {
      case "why_loop":
        return "magnifying-glass"
      case "then_loop":
        return "arrow-right"
      case "pre_action":
        return "circle-ban-sign"
      case "hypothesis_update":
        return "pencil-line"
      case "evi_score":
        return "magnifying-glass-menu"
      case "counterfactual":
        return "circle-x"
      case "self_consistency":
        return "circle-check"
      case "temporal_guard":
        return "arrow-undo-down"
    }
  }

  return (
    <div class="h-full flex flex-col">
      <div class="h-full flex-1 overflow-y-auto p-4 space-y-4">
        <Show when={reasoningLog().length === 0} fallback={<For each={reasoningLog()}>{(entry) => <ReasoningEntry entry={entry} getTypeLabel={getTypeLabel} getTypeIcon={getTypeIcon} language={language} />}</For>}>
          <div class="flex flex-col items-center justify-center h-full text-center text-text-weak">
            <Icon name="brain" class="w-12 h-12 opacity-20 mb-4" />
            <div class="text-14-regular">{language.t("session.reasoning.empty")}</div>
          </div>
        </Show>
      </div>
    </div>
  )
}

function ReasoningEntry(props: {
  entry: ReasoningLogEntry
  getTypeLabel: (type: ReasoningLogEntry["type"]) => string
  getTypeIcon: (type: ReasoningLogEntry["type"]) => IconName
  language: ReturnType<typeof import("@/context/language").useLanguage>
}) {
  const { entry, getTypeLabel, getTypeIcon, language } = props
  const iconName = getTypeIcon(entry.type)
  return (
    <div class="rounded-lg border border-border-weaker p-3 space-y-2">
      <div class="flex items-center gap-2 text-12-medium text-text-muted">
        <Icon name={iconName} class="w-4 h-4" />
        <span>{getTypeLabel(entry.type)}</span>
        <span class="text-text-weaker ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="text-13-regular text-text-base whitespace-pre-wrap font-mono">{entry.content}</div>
      <Show when={Object.keys(entry.metadata).length > 0}>
        <details class="text-11-regular text-text-weak">
          <summary>{language.t("session.reasoning.metadata")}</summary>
          <pre class="mt-1 p-2 bg-background-weaker rounded text-xs overflow-x-auto">{JSON.stringify(entry.metadata, null, 2)}</pre>
        </details>
      </Show>
    </div>
  )
}