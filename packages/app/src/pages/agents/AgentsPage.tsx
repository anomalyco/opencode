import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { sessionHref } from "@/utils/session-route"
import { useFleet } from "./useFleet"
import { money } from "./lib/format"
import { loadSplitPct, saveSplitPct } from "./lib/persist"
import type { FleetFilterKind } from "./fleetTypes"
import FleetTable from "./components/FleetTable"
import FleetOverview from "./components/FleetOverview"
import SessionDetail from "./components/SessionDetail"

const WINDOWS = ["5m", "1h", "24h"] as const
const FILTERS: { key: FleetFilterKind; label: string }[] = [
  { key: "all", label: "agents.filter.all" },
  { key: "working", label: "agents.filter.working" },
  { key: "input", label: "agents.filter.input" },
  { key: "idle", label: "agents.filter.idle" },
  { key: "error", label: "agents.filter.error" },
]

const segment = (active: boolean) => ({
  "px-2 py-0.5 rounded-md text-12-medium": true,
  "bg-surface-base-active text-text-strong": active,
  "text-text-weak hover:text-text-base": !active,
})

export default function AgentsPage(): JSX.Element {
  const language = useLanguage()
  const fleet = useFleet()
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()
  const [selectedID, setSelectedID] = createSignal<string | null>(null)
  const [pct, setPct] = createSignal(loadSplitPct())
  const [width, setWidth] = createSignal(0)
  const [showOverview, setShowOverview] = createSignal(false)
  let body: HTMLDivElement | undefined

  const NARROW_BREAKPOINT = 1100
  const MIN_TABLE_WIDTH = 560
  const isNarrow = createMemo(() => width() > 0 && width() < NARROW_BREAKPOINT)

  const selectedRow = createMemo(() => fleet.rows().find((row) => row.sessionID === selectedID()))
  const liveCount = createMemo(() => fleet.rows().filter((row) => row.live).length)
  const projects = createMemo(() => [...new Set([...fleet.projects(), ...fleet.rows().map((row) => row.directory)])].sort())

  const dispatch = () => {
    const directory = fleet.filter().project ?? selectedRow()?.directory ?? fleet.projects()[0]
    if (!directory) return
    void tabs.newDraft({ server: server.key, directory })
  }

  onMount(() => {
    const measure = () => setWidth(body?.clientWidth ?? 0)
    measure()
    const observer = new ResizeObserver(measure)
    if (body) observer.observe(body)
    onCleanup(() => observer.disconnect())
  })

  // j/k walk visible rows, Enter opens, Esc clears; ignored while typing.
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const nodes = fleet.nodes()
    const index = nodes.findIndex((node) => node.row.sessionID === selectedID())
    if (event.key === "j" || event.key === "k") {
      if (nodes.length === 0) return
      const next = event.key === "j" ? Math.min(nodes.length - 1, index + 1) : Math.max(0, index - 1)
      const id = nodes[next]!.row.sessionID
      setSelectedID(id)
      document.querySelector(`[data-session-id="${id}"]`)?.scrollIntoView({ block: "nearest" })
      event.preventDefault()
    } else if (event.key === "Escape") {
      setSelectedID(null)
    } else if (event.key === "Enter" && selectedID() && target === document.body) {
      navigate(sessionHref(server.key, selectedID()!))
    } else if (event.key === "n") {
      dispatch()
    }
  }
  onMount(() => document.addEventListener("keydown", onKey))
  onCleanup(() => document.removeEventListener("keydown", onKey))

  const detailWidth = () => {
    const raw = Math.round((width() * pct()) / 100)
    return Math.min(Math.max(raw, 320), Math.max(320, width() - MIN_TABLE_WIDTH))
  }

  // Narrow mode: the right pane becomes a slide-over. It's "open" when a row is selected,
  // or the user tapped the Spend toggle to peek at FleetOverview.
  const paneOpen = createMemo(() => selectedRow() != null || showOverview())
  const closePane = () => {
    setSelectedID(null)
    setShowOverview(false)
  }

  return (
    <div class="flex flex-col h-full min-h-0 bg-background-base text-text-base">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-b border-border-weaker-base">
        <span class="text-14-medium text-text-strong whitespace-nowrap">{language.t("agents.title")}</span>
        <span class="flex items-center gap-1.5 text-12-mono tabular-nums whitespace-nowrap">
          <span
            class="size-2 rounded-full"
            style={{ "background-color": liveCount() > 0 ? "var(--icon-success-base)" : "var(--icon-weak-base)" }}
          />
          {liveCount()} {language.t("agents.live")}
        </span>
        <span class="text-12-mono tabular-nums text-text-weak whitespace-nowrap">{(fleet.out1mAll() / 60).toFixed(1)} tok/s</span>
        <span class="text-12-mono tabular-nums text-text-weak whitespace-nowrap" title={language.t("agents.cost.rate")}>
          ${money(fleet.cost().window.costPerHour)}/h
        </span>
        <span class="text-12-mono tabular-nums text-text-weak whitespace-nowrap" title={language.t("agents.cost.total")}>
          Σ ${money(fleet.totalCost())}
        </span>
        <Show when={isNarrow()}>
          <button
            type="button"
            classList={segment(showOverview() && selectedRow() == null)}
            onClick={() => {
              setSelectedID(null)
              setShowOverview((open) => !open)
            }}
          >
            {language.t("agents.cost.show")}
          </button>
        </Show>
        <span class="ml-auto flex items-center gap-0.5 whitespace-nowrap">
          <For each={WINDOWS}>
            {(value) => (
              <button type="button" classList={segment(fleet.window() === value)} onClick={() => fleet.setWindow(value)}>
                {value}
              </button>
            )}
          </For>
        </span>
        <Button variant="primary" size="small" icon="plus-small" onClick={dispatch} disabled={fleet.projects().length === 0}>
          {language.t("agents.action.dispatch")}
        </Button>
      </div>

      <Show when={fleet.attention().length > 0}>
        <div class="flex items-center gap-2 px-4 py-2 border-b border-border-weaker-base bg-surface-warning-base overflow-x-auto whitespace-nowrap">
          <Icon name="warning" size="small" class="text-icon-warning-base shrink-0" />
          <span class="text-12-medium text-text-strong shrink-0">
            {language.t("agents.attention.count", { count: fleet.attention().length })}
          </span>
          <For each={fleet.attention()}>
            {(item) => (
              <button
                type="button"
                onClick={() => setSelectedID(item.sessionID)}
                class="flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-12-regular shrink-0"
                classList={{
                  "border-border-warning-base bg-surface-base-active text-text-strong": selectedID() === item.sessionID,
                  "border-border-weak-base bg-surface-base text-text-base hover:bg-surface-base-hover":
                    selectedID() !== item.sessionID,
                }}
              >
                <span class="text-text-weak">
                  {item.kind === "permission" ? item.request.permission : language.t("agents.attention.question")}
                </span>
                <span class="max-w-60 truncate">{item.title || item.sessionID}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="flex flex-wrap items-center gap-1 px-4 py-1.5 border-b border-border-weaker-base">
        <For each={FILTERS}>
          {(entry) => (
            <button
              type="button"
              class="whitespace-nowrap"
              classList={segment(fleet.filter().kind === entry.key)}
              onClick={() => fleet.setFilterKind(entry.key)}
            >
              {language.t(entry.label as Parameters<typeof language.t>[0])}
            </button>
          )}
        </For>
        <select
          value={fleet.filter().project ?? ""}
          onChange={(event) => fleet.setProject(event.currentTarget.value || null)}
          aria-label={language.t("agents.project.all")}
          class="ml-auto max-w-60 rounded-md bg-surface-base border border-border-weak-base px-2 py-0.5 text-12-regular text-text-base"
        >
          <option value="">{language.t("agents.project.all")}</option>
          <For each={projects()}>
            {(directory) => <option value={directory}>{directory.split("/").pop() || directory}</option>}
          </For>
        </select>
        <span class="text-12-regular text-text-weak pl-2 whitespace-nowrap">{language.t("agents.keys")}</span>
      </div>

      <div ref={body} class="relative flex flex-1 min-h-0 min-w-0">
        <div class="flex-1 min-w-0 min-h-0">
          <FleetTable
            nodes={fleet.nodes()}
            selectedID={selectedID()}
            onSelect={(id) => setSelectedID((current) => (current === id ? null : id))}
            onToggle={fleet.toggleCollapsed}
            window={fleet.window()}
          />
        </div>

        <Show when={!isNarrow()}>
          <div class="relative shrink-0 border-l border-border-weaker-base min-h-0" style={{ width: `${detailWidth()}px` }}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={detailWidth()}
              min={Math.round(width() * 0.25)}
              max={Math.round(width() * 0.75)}
              onResize={(px) => {
                if (width() <= 0) return
                const next = Math.min(75, Math.max(25, (px / width()) * 100))
                setPct(next)
                saveSplitPct(next)
              }}
            />
            <Show
              when={selectedRow()}
              keyed
              fallback={<FleetOverview cost={fleet.cost()} totalCost={fleet.totalCost()} window={fleet.window()} />}
            >
              {(row) => <SessionDetail row={row} attention={fleet.attention()} />}
            </Show>
          </div>
        </Show>

        <Show when={isNarrow() && paneOpen()}>
          <div class="absolute inset-0 z-40 bg-black/40" onClick={closePane} />
          <div
            class="absolute inset-y-0 right-0 z-50 flex flex-col min-h-0 border-l border-border-weaker-base bg-background-base shadow-lg"
            style={{ width: "min(560px, 100%)" }}
          >
            <div class="flex items-center justify-end px-2 py-1.5 border-b border-border-weaker-base shrink-0">
              <button
                type="button"
                class="size-6 flex items-center justify-center rounded-md text-icon-weak-base hover:text-icon-base hover:bg-surface-base-hover"
                aria-label={language.t("agents.action.close")}
                onClick={closePane}
              >
                <Icon name="close" size="small" />
              </button>
            </div>
            <div class="flex-1 min-h-0">
              <Show
                when={selectedRow()}
                keyed
                fallback={<FleetOverview cost={fleet.cost()} totalCost={fleet.totalCost()} window={fleet.window()} />}
              >
                {(row) => <SessionDetail row={row} attention={fleet.attention()} />}
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
