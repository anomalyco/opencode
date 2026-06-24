/**
 * `/monitor` — landing page for the monitor module.
 *
 * Layout: 4 tabs persisted in localStorage (`monitor.activeTab`).
 *   1. Kanban (sessions / agents)        — `<MonitorKanban />`
 *   2. Health (composite score + gauges) — `<MonitorHealth />`
 *   3. Workflows (D3 datasets)           — `<MonitorWorkflows />`
 *   4. Alerts (rules + activity feed)    — `<MonitorAlerts />`
 *
 * The page is dumb about data fetching: each tab owns its own resource
 * via `@tanstack/solid-query`. This file only handles the active-tab
 * persistence and the locale-aware copy.
 */

import { createSignal, For, Match, Switch } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { MonitorKanban } from "./monitor-kanban"
import { MonitorHealth } from "./monitor-health"
import { MonitorWorkflows } from "./monitor-workflows"
import { MonitorAlerts } from "./monitor-alerts"
import { MonitorChannels } from "./monitor-channels"
import { TabbyPanel } from "@/components/monitor/tabby-panel"
import { TabbyMascot } from "@/components/monitor/tabby-mascot"

type Tab = "kanban" | "health" | "workflows" | "alerts" | "channels"
const TABS: { id: Tab; key: string }[] = [
  { id: "kanban", key: "monitor.tab.kanban" },
  { id: "health", key: "monitor.tab.health" },
  { id: "workflows", key: "monitor.tab.workflows" },
  { id: "alerts", key: "monitor.tab.alerts" },
  { id: "channels", key: "monitor.tab.channels" },
]

const TAB_STORAGE_KEY = "monitor.activeTab"

function readStoredTab(): Tab {
  if (typeof localStorage === "undefined") return "kanban"
  const v = localStorage.getItem(TAB_STORAGE_KEY)
  return TABS.some((t) => t.id === v) ? (v as Tab) : "kanban"
}

export default function Monitor() {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const sync = useSync()
  const [active, setActive] = createSignal<Tab>(readStoredTab())

  function select(tab: Tab) {
    setActive(tab)
    if (typeof localStorage !== "undefined") localStorage.setItem(TAB_STORAGE_KEY, tab)
  }

  const baseUrl = () => sdk.url
  const directory = () => sync.data.path.directory

  return (
    <div class="size-full overflow-y-auto">
      <header class="flex items-center justify-between px-6 py-4 border-b border-border-weak-base">
        <div class="flex flex-col">
          <h1 class="text-16-medium text-text-strong">{language.t("monitor.title")}</h1>
          <span class="text-12-regular text-text-weak">project {directory()}</span>
        </div>
        <nav class="flex gap-1">
          <For each={TABS}>
            {(tab) => (
              <button
                type="button"
                onClick={() => select(tab.id)}
                aria-current={active() === tab.id ? "page" : undefined}
                classList={{
                  "px-3 py-1.5 text-13-medium rounded-md transition-colors": true,
                  "bg-surface-strong-base text-text-strong": active() === tab.id,
                  "text-text-weak hover:text-text-base hover:bg-surface-base": active() !== tab.id,
                }}
              >
                {language.t(tab.key)}
              </button>
            )}
          </For>
        </nav>
      </header>

      <main class="p-6">
        <Switch>
          <Match when={active() === "kanban"}>
            <MonitorKanban baseUrl={baseUrl()} />
          </Match>
          <Match when={active() === "health"}>
            <MonitorHealth baseUrl={baseUrl()} />
          </Match>
          <Match when={active() === "workflows"}>
            <MonitorWorkflows baseUrl={baseUrl()} />
          </Match>
          <Match when={active() === "alerts"}>
            <MonitorAlerts baseUrl={baseUrl()} />
          </Match>
          <Match when={active() === "channels"}>
            <MonitorChannels baseUrl={baseUrl()} />
          </Match>
        </Switch>
      </main>

      <TabbyMascot baseUrl={baseUrl()} />
      <TabbyPanel baseUrl={baseUrl()} />
    </div>
  )
}
