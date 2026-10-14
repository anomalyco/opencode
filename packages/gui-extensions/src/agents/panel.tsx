import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Select } from "@opencode/ui/select"
import { useI18n } from "@opencode/ui/context/i18n"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import type { SessionInfo } from "@opencode/client/promise"
import type { IconName } from "@opencode/ui/icons/catalog"
import { createKeyed, useExtension, type MountedSession } from "../sdk"
import type definition from "./index"
import {
  childHref,
  childrenCost,
  childrenOf,
  childStatus,
  filterAgents,
  formatCost,
  formatElapsed,
  formatRelative,
  formatTokens,
  latestActivity,
  lastResponse,
  sortAgents,
  stripSubagentSuffix,
  subagentDescriptions,
  subagentTasks,
  tokenTotal,
  treeCost,
  type AgentSort,
  type DerivedStatus,
} from "./status"

type SectionTab = "all" | "running" | "history"

const sortOptions: AgentSort[] = ["recent", "cost", "tokens", "name"]

/** MountedSession keys join server key and session id with a newline. */
function sessionServerKey(session: MountedSession): string {
  return session.key.split("\n")[0] ?? ""
}

function statusLabel(status: DerivedStatus, t: (key: string) => string): string {
  if (status === "busy") return t("status.busy")

  if (status === "cancelled") return t("status.cancelled")

  if (status === "completed") return t("status.completed")

  if (status === "error") return t("status.error")

  return t("status.idle")
}

function sortLabel(sort: AgentSort, t: (key: string) => string): string {
  if (sort === "cost") return t("sort.cost")

  if (sort === "tokens") return t("sort.tokens")

  if (sort === "name") return t("sort.name")

  return t("sort.recent")
}

function AgentStatusIcon(props: { status: DerivedStatus }) {
  return (
    <Show when={props.status === "busy"} fallback={<Icon name="subagent" size="small" class="shrink-0" />}>
      <SessionProgressIndicatorV2 class="size-3.5 shrink-0" />
    </Show>
  )
}

function RunningPill(props: { label: string }) {
  return (
    <span class="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--v2-border-border-base)] px-2 py-0.5 text-12-regular text-v2-text-text-accent">
      <SessionProgressIndicatorV2 class="size-3 shrink-0" />
      {props.label}
    </span>
  )
}

function toolIcon(tool: string): IconName {
  if (tool === "edit" || tool === "write") return "edit"

  if (tool === "read") return "filetree"

  if (tool === "grep" || tool === "websearch") return "magnifying-glass"

  if (tool === "shell" || tool === "task" || tool === "subagent") return "console"

  if (tool === "webfetch") return "globe"

  return "filetree"
}

export default function SessionAgentsPanel(props: { session: MountedSession }) {
  const ctx = useExtension<typeof definition>()
  const i18n = useI18n()
  const data = () => props.session.server.data
  const serverKey = sessionServerKey(props.session)

  // One-shot family plus transcript load per routed session; the live event stream owns freshness after that,
  // so the tab needs no polling and no per-child requests.
  createKeyed(
    () => (props.session.server.connected ? props.session.id : undefined),
    (id) => {
      const store = props.session.server.data
      void store.session.sync(id, { children: true }).catch(() => undefined)
      void store.session.message.sync(id).catch(() => undefined)
    },
  )

  const [query, setQuery] = createSignal("")
  const [sort, setSort] = createSignal<AgentSort>("recent")
  const [ascending, setAscending] = createSignal(false)
  const [tab, setTab] = createSignal<SectionTab>("all")
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [loaded, setLoaded] = createStore<Record<string, boolean>>({})
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const children = createMemo(() => childrenOf(data().session.list(), props.session.id))
  const info = createMemo(() => data().session.get(props.session.id))
  const tasks = createMemo(() => subagentTasks(data().session.message.list(props.session.id)))
  const descriptions = createMemo(() => subagentDescriptions(data().session.message.list(props.session.id)))

  const titleOf = (child: SessionInfo): string => {
    const description = descriptions().get(child.id)

    if (description) return description

    if (child.title) return stripSubagentSuffix(child.title)

    return child.id
  }

  const titles = createMemo(() => new Map(children().map((child) => [child.id, titleOf(child)] as const)))
  const nameOf = (id: string): string => titles().get(id) ?? id

  const statusOf = (id: string): DerivedStatus => {
    const store = data()

    return childStatus({
      part: tasks().parts.get(id),
      running: store.session.status(id) === "running",
      outcome: store.session.get(id)?.outcome,
    })
  }

  // Foreground calls with no child session yet: still running, nothing to drill into.
  const unclaimed = createMemo(() => {
    const known = new Set(children().map((child) => child.id))

    return tasks().blocking.filter((item) => !item.childID || !known.has(item.childID))
  })

  const totalCost = createMemo(() => treeCost(info()?.cost, children()))
  const subCost = createMemo(() => childrenCost(children()))
  const ownCost = createMemo(() => info()?.cost ?? 0)

  const filtered = createMemo(() => filterAgents(children(), query(), nameOf))
  const sorted = createMemo(() => sortAgents(filtered(), { sort: sort(), ascending: ascending(), name: nameOf }))

  const busyIDs = createMemo(
    () =>
      new Set(
        sorted()
          .filter((child) => statusOf(child.id) === "busy")
          .map((child) => child.id),
      ),
  )

  const running = createMemo(() => sorted().filter((child) => busyIDs().has(child.id)))
  const history = createMemo(() => sorted().filter((child) => !busyIDs().has(child.id)))

  const runningCount = createMemo(() => running().length + unclaimed().length)

  // Message detail for the few running children; history rows sync on expand instead.
  // Already-synced children stay out: membership churn must not refetch the survivors.
  const [synced, setSynced] = createSignal<ReadonlySet<string>>(new Set())

  const runningKey = createMemo(() => {
    const ids = children()
      .filter((child) => statusOf(child.id) === "busy")
      .map((child) => child.id)
      .sort()

    return ids.length > 0 ? ids.join(" ") : undefined
  })

  createKeyed(runningKey, (key) => {
    const store = props.session.server.data
    const fresh = key.split(" ").filter((id) => !synced().has(id))

    if (fresh.length === 0) return

    setSynced((prev) => new Set([...prev, ...fresh]))
    void Promise.all(fresh.map((id) => store.session.message.sync(id))).catch(() => undefined)
  })

  const toggle = (child: SessionInfo, defaultOpen: boolean) => {
    const open = expanded[child.id] ?? defaultOpen
    setExpanded(child.id, !open)

    if (!open && !loaded[child.id]) {
      void data()
        .session.message.sync(child.id)
        .then(() => setLoaded(child.id, true))
        .catch(() => undefined)
    }
  }

  const searching = createMemo(() => query().trim().length > 0)
  const visibleRunning = createMemo(() => (tab() === "history" ? [] : running()))
  const visibleUnclaimed = createMemo(() => (tab() === "history" ? [] : unclaimed()))
  const visibleHistory = createMemo(() => (tab() === "running" ? [] : history()))

  const emptyText = () => {
    if (searching() && visibleRunning().length + visibleUnclaimed().length + visibleHistory().length === 0)
      return ctx.t("emptySearch")

    if (tab() === "running") return ctx.t("emptyRunning")

    if (tab() === "history") return ctx.t("emptyHistory")

    return ctx.t("empty")
  }

  const showSections = () =>
    visibleRunning().length + visibleUnclaimed().length + visibleHistory().length > 0 || tab() !== "all" || searching()

  return (
    <ScrollView class="h-full">
      <div class="px-4 pt-4 pb-6 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-12-medium text-text-strong">{ctx.t("tab.title")}</span>
            <span class="rounded-full border border-[var(--v2-border-border-base)] px-1.5 text-12-regular text-text-weak">
              {children().length.toLocaleString(i18n.locale())}
            </span>
          </div>
          <div class="flex flex-col items-end gap-0.5 shrink-0">
            <span class="text-12-regular text-text-weak whitespace-nowrap">
              {runningCount().toLocaleString(i18n.locale())} {ctx.t("status.busy")}
            </span>
            <span class="text-12-medium text-text-strong whitespace-nowrap">
              {ctx.t("total")} {formatCost(totalCost(), i18n.locale())}
            </span>
            <span class="text-12-regular text-text-faint whitespace-nowrap">
              {ctx.t("subagents")} {formatCost(subCost(), i18n.locale())} · {ctx.t("session")}{" "}
              {formatCost(ownCost(), i18n.locale())}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <div class="relative flex-1 min-w-0">
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={ctx.t("search.placeholder")}
              aria-label={ctx.t("search.placeholder")}
              class="w-full rounded-md border border-[var(--v2-border-border-base)] bg-transparent py-1.5 pl-8 pr-2 text-12-regular text-text-strong placeholder:text-text-faint focus:outline-none"
            />
          </div>
          <Select
            options={sortOptions}
            current={sort()}
            label={(option) => sortLabel(option, ctx.t)}
            placement="bottom-end"
            gutter={6}
            onSelect={(option) => {
              if (option) setSort(option)
            }}
          />
          <button
            type="button"
            aria-label={ctx.t("sort.direction")}
            onClick={() => setAscending(!ascending())}
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-text-weak hover:text-text-strong transition-colors"
          >
            <span class={ascending() ? "" : "rotate-180"}>
              <Icon name="arrow-up" size="small" />
            </span>
          </button>
        </div>

        <div class="flex items-center gap-4">
          <TabButton
            active={tab() === "all"}
            onClick={() => setTab("all")}
            label={ctx.t("tab.all")}
            count={children().length + unclaimed().length}
          />
          <TabButton
            active={tab() === "running"}
            onClick={() => setTab("running")}
            label={ctx.t("tab.running")}
            count={runningCount()}
          />
          <TabButton
            active={tab() === "history"}
            onClick={() => setTab("history")}
            label={ctx.t("tab.history")}
            count={history().length}
          />
        </div>

        <Show when={showSections()} fallback={<div class="text-12-regular text-text-weak">{emptyText()}</div>}>
          <Show when={visibleRunning().length + visibleUnclaimed().length > 0}>
            <div class="flex flex-col gap-2">
              <Show when={tab() === "all"}>
                <SectionTitle label={ctx.t("tab.running")} count={runningCount()} />
              </Show>
              <For each={visibleUnclaimed()}>
                {(item) => (
                  <div class="flex items-center gap-3 w-full rounded-md px-3 py-2 text-left">
                    <AgentStatusIcon status="busy" />
                    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span class="text-12-medium text-text-strong truncate min-w-0">{item.label}</span>
                      <div class="text-12-regular text-text-weak flex items-center gap-1.5 min-w-0">
                        <span>{statusLabel("busy", ctx.t)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              <For each={visibleRunning()}>
                {(child) => <ChildRow child={child} defaultOpen serverKey={serverKey} />}
              </For>
            </div>
          </Show>

          <Show when={visibleHistory().length > 0}>
            <div class="flex flex-col gap-2">
              <Show when={tab() === "all"}>
                <SectionTitle label={ctx.t("tab.history")} count={history().length} />
              </Show>
              <div class="flex items-center justify-end gap-3 px-3 text-12-regular text-text-faint">
                <span class="w-16 shrink-0 whitespace-nowrap text-right capitalize">{ctx.t("tokens")}</span>
                <span class="w-20 shrink-0 whitespace-nowrap text-right">{ctx.t("cost")}</span>
              </div>
              <For each={visibleHistory()}>
                {(child) => <ChildRow child={child} defaultOpen={false} serverKey={serverKey} />}
              </For>
            </div>
          </Show>

          <Show when={visibleRunning().length + visibleUnclaimed().length + visibleHistory().length === 0}>
            <div class="text-12-regular text-text-weak">{emptyText()}</div>
          </Show>
        </Show>

        <div class="text-12-regular text-text-faint text-right">{ctx.t("footerNote")}</div>
      </div>
    </ScrollView>
  )

  function TabButton(props: { active: boolean; onClick: () => void; label: string; count: number }) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        class={
          props.active
            ? "flex items-center gap-1.5 border-b-2 border-current pb-1 text-12-medium text-text-strong"
            : "flex items-center gap-1.5 border-b-2 border-transparent pb-1 text-12-regular text-text-weak hover:text-text-strong transition-colors"
        }
      >
        <span>{props.label}</span>
        <span class="text-text-faint">{props.count.toLocaleString(i18n.locale())}</span>
      </button>
    )
  }

  function SectionTitle(props: { label: string; count: number }) {
    return (
      <div class="flex items-center gap-1.5">
        <span class="text-12-medium text-text-strong">{props.label}</span>
        <span class="text-12-regular text-text-faint">({props.count.toLocaleString(i18n.locale())})</span>
      </div>
    )
  }

  function ChildRow(props: { child: SessionInfo; defaultOpen: boolean; serverKey: string }) {
    const status = createMemo(() => statusOf(props.child.id))
    const title = createMemo(() => titleOf(props.child))
    const open = createMemo(() => expanded[props.child.id] ?? props.defaultOpen)

    const activity = createMemo(() =>
      status() === "busy" ? latestActivity(data().session.message.list(props.child.id)) : [],
    )

    const response = createMemo(() =>
      open() && status() !== "busy" ? lastResponse(data().session.message.list(props.child.id)) : undefined,
    )

    const ready = createMemo(() => loaded[props.child.id] ?? false)

    return (
      <div class="flex flex-col rounded-md px-3 py-2 hover:bg-surface-hover transition-colors">
        <div class="flex items-center gap-3 w-full text-left">
          <button
            type="button"
            aria-label={title()}
            onClick={() => toggle(props.child, props.defaultOpen)}
            class="flex shrink-0 items-center"
          >
            <Show when={open()} fallback={<Icon name="chevron-right" size="small" class="shrink-0" />}>
              <Icon name="chevron-down" size="small" class="shrink-0" />
            </Show>
          </button>
          <AgentStatusIcon status={status()} />
          <a
            href={childHref(props.serverKey, props.child.id)}
            class="text-12-medium text-text-strong truncate min-w-0 flex-1 hover:underline"
          >
            {title()}
          </a>
          <Show when={status() === "busy"}>
            <RunningPill label={statusLabel(status(), ctx.t)} />
          </Show>
          <Show when={status() !== "busy"}>
            <span class="w-16 shrink-0 whitespace-nowrap text-right text-12-regular text-text-weak">
              {formatTokens(tokenTotal(props.child.tokens))}
            </span>
            <span class="w-20 shrink-0 whitespace-nowrap text-right text-12-regular text-text-weak">
              {formatCost(props.child.cost, i18n.locale())}
            </span>
          </Show>
        </div>

        <Show when={!(open() && status() === "busy")}>
          <div class="text-12-regular text-text-weak truncate pl-8">
            {statusLabel(status(), ctx.t)}
            <Show when={props.child.model}>{(model) => <> · {model().id}</>}</Show>
          </div>
        </Show>

        <Show when={open() && status() === "busy"}>
          <div class="flex flex-col gap-1 pt-1 pl-8">
            <Show when={props.child.model}>
              {(model) => (
                <span class="text-12-regular text-text-weak truncate">
                  {model().id} · {model().providerID}
                </span>
              )}
            </Show>
            <div class="text-12-regular text-text-weak flex items-center gap-1.5 flex-wrap">
              <span>{ctx.t("elapsed", { value: formatElapsed(props.child.time.created, now()) })}</span>
              <span class="text-text-faint">·</span>
              <span>
                {formatTokens(tokenTotal(props.child.tokens))} {ctx.t("tokens")}
              </span>
              <span class="text-text-faint">·</span>
              <span>{formatCost(props.child.cost, i18n.locale())}</span>
            </div>
            <Show when={activity().length > 0}>
              <div class="text-12-regular text-text-weak pt-1">{ctx.t("latestActivity")}</div>
              <For each={activity()}>
                {(entry) => (
                  <div class="flex items-center gap-2 text-12-regular min-w-0">
                    <Icon name={toolIcon(entry.tool)} size="small" class="shrink-0" />
                    <span class="text-text-strong shrink-0">{entry.tool}</span>
                    <Show when={entry.target}>
                      <span class="text-text-weak truncate min-w-0 flex-1">{entry.target}</span>
                    </Show>
                    <span class="text-text-faint shrink-0">{formatRelative(entry.at, now(), i18n.locale())}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={open() && status() !== "busy"}>
          <div class="flex flex-col gap-1 pt-1 pl-8">
            <div class="text-12-regular text-text-weak">{ctx.t("lastResponse")}</div>
            <Show
              when={response()}
              fallback={
                <Show when={!ready()}>
                  <SessionProgressIndicatorV2 class="size-3.5" />
                </Show>
              }
            >
              {(text) => (
                <div class="rounded-md border border-[var(--v2-border-border-base)] px-3 py-2 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                  {text()}
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    )
  }
}
