/**
 * Monitor / Kanban tab.
 *
 * Two view modes (sessions / agents) persisted in localStorage. Cards
 * are grouped by status into 5 columns. Empty columns render a tiny
 * placeholder so the layout does not collapse.
 */

import { createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { createMonitorClient } from "@/utils/monitor-sdk"
import type { KanbanBoard, KanbanCard } from "@/utils/monitor-schema"

const VIEW_STORAGE_KEY = "monitor.kanban.view"

function readView(): "sessions" | "agents" {
  if (typeof localStorage === "undefined") return "sessions"
  const v = localStorage.getItem(VIEW_STORAGE_KEY)
  return v === "agents" ? "agents" : "sessions"
}

const STATUS_KEYS = [
  { id: "working", key: "monitor.kanban.working", accent: "bg-status-working-base" },
  { id: "waiting", key: "monitor.kanban.waiting", accent: "bg-status-waiting-base" },
  { id: "completed", key: "monitor.kanban.completed", accent: "bg-status-completed-base" },
  { id: "error", key: "monitor.kanban.error", accent: "bg-status-error-base" },
  { id: "abandoned", key: "monitor.kanban.abandoned", accent: "bg-status-abandoned-base" },
] as const

function Card(props: { card: KanbanCard; language: ReturnType<typeof useLanguage> }) {
  const card = props.card
  return (
    <article class="rounded-lg border border-border-weak-base bg-surface-base p-3 text-12-regular">
      <header class="flex items-start justify-between gap-2 mb-1">
        <span class="text-text-strong font-medium truncate">{card.title}</span>
        <Show when={card.last_tool}>
          <code class="px-1.5 py-0.5 rounded bg-surface-strong-base text-text-weak text-11-regular">
            {card.last_tool}
          </code>
        </Show>
      </header>
      <footer class="flex items-center justify-between text-text-weak text-11-regular">
        <Show when={card.model}>{(m) => <span>{m()}</span>}</Show>
        <span>${card.cost.toFixed(4)}</span>
      </footer>
    </article>
  )
}

export function MonitorKanban(props: { baseUrl: string }) {
  const language = useLanguage()
  const [view, setView] = createSignal<"sessions" | "agents">(readView())
  const client = createMonitorClient({ baseUrl: props.baseUrl })
  const [board] = createResource(
    () => view(),
    (v) => client.kanban(v),
  )

  function select(next: "sessions" | "agents") {
    setView(next)
    if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={() => select("sessions")}
          classList={{
            "px-2 py-1 text-12-medium rounded": true,
            "bg-surface-strong-base text-text-strong": view() === "sessions",
            "text-text-weak hover:text-text-base": view() !== "sessions",
          }}
        >
          {language.t("monitor.kanban.view.sessions")}
        </button>
        <button
          type="button"
          onClick={() => select("agents")}
          classList={{
            "px-2 py-1 text-12-medium rounded": true,
            "bg-surface-strong-base text-text-strong": view() === "agents",
            "text-text-weak hover:text-text-base": view() !== "agents",
          }}
        >
          {language.t("monitor.kanban.view.agents")}
        </button>
      </div>

      <Show
        when={board()}
        fallback={<p class="text-text-weak text-13-regular">{language.t("monitor.common.loading")}</p>}
      >
        {(b) => (
          <div class="grid gap-3" style={{ "grid-template-columns": "repeat(5, minmax(0, 1fr))" }}>
            <For each={STATUS_KEYS}>
              {(col) => {
                const list = () => b().columns[col.id] 
                return (
                  <section class="flex flex-col gap-2 min-h-32">
                    <header class="flex items-center gap-2 text-12-medium text-text-base">
                      <span class={`size-2 rounded-full ${col.accent}`} />
                      <span>{language.t(col.key)}</span>
                      <span class="text-text-weak text-11-regular">({list().length})</span>
                    </header>
                    <Show
                      when={list().length}
                      fallback={
                        <p class="text-11-regular text-text-weak">{language.t("monitor.kanban.empty")}</p>
                      }
                    >
                      <For each={list()}>{(card) => <Card card={card} language={language} />}</For>
                    </Show>
                  </section>
                )
              }}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}
