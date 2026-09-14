import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { Pulse } from "./Pulse"
import { SparkBars } from "./Spark"
import { latText, money, pctText, rateText, tok } from "../lib/format"
import type { TreeNode } from "../lib/tree"
import type { FleetRowData, FleetSeverity } from "../fleetTypes"

export const SEVERITY_COLOR: Record<FleetSeverity, string> = {
  cyan: "var(--icon-info-base)",
  mid: "var(--text-base)",
  green: "var(--icon-success-base)",
  amber: "var(--icon-warning-base)",
  bright: "var(--text-strong)",
  dim: "var(--text-weak)",
  red: "var(--icon-critical-base)",
}

type ColID = "stage" | "in" | "out" | "rate" | "cache" | "cost" | "lat" | "spark"

// Left-to-right display order (name is always first, not included here).
const DISPLAY_ORDER: ColID[] = ["stage", "in", "out", "rate", "cache", "cost", "lat", "spark"]

// Fixed pixel width per optional column (matches the original fixed grid).
const COL_WIDTH: Record<ColID, number> = {
  stage: 72,
  in: 64,
  out: 64,
  rate: 56,
  cache: 52,
  cost: 72,
  lat: 56,
  spark: 96,
}

// Drop order when space runs out — first entry drops first. Keep-priority is the reverse:
// name (always kept) > stage > out > cost > spark > rate (tok/s) > in > cache > lat.
const DROP_ORDER: ColID[] = ["lat", "cache", "in", "rate", "spark", "cost", "out", "stage"]

const NAME_MIN = 160
const GAP = 8 // gap-2
const ROW_PAD = 24 // px-3 on both sides

function visibleColumns(width: number): ColID[] {
  const visible = new Set<ColID>(DISPLAY_ORDER)
  const fits = (cols: Set<ColID>) => {
    const count = cols.size + 1 // +1 for the name column
    let fixed = 0
    for (const id of cols) fixed += COL_WIDTH[id]
    const total = ROW_PAD + fixed + NAME_MIN + GAP * (count - 1)
    return total <= width
  }
  if (width <= 0) return DISPLAY_ORDER
  for (const id of DROP_ORDER) {
    if (fits(visible)) break
    visible.delete(id)
  }
  return DISPLAY_ORDER.filter((id) => visible.has(id))
}

export default function FleetTable(props: {
  nodes: TreeNode<FleetRowData>[]
  selectedID: string | null
  onSelect: (sessionID: string) => void
  onToggle: (sessionID: string) => void
  window: string
}): JSX.Element {
  const language = useLanguage()
  const [width, setWidth] = createSignal(0)
  let root: HTMLDivElement | undefined

  onMount(() => {
    const measure = () => setWidth(root?.clientWidth ?? 0)
    measure()
    const observer = new ResizeObserver(measure)
    if (root) observer.observe(root)
    onCleanup(() => observer.disconnect())
  })

  const cols = createMemo(() => visibleColumns(width()))
  const gridTemplate = createMemo(() => ["minmax(0,1fr)", ...cols().map((id) => `${COL_WIDTH[id]}px`)].join(" "))
  const has = (id: ColID) => cols().includes(id)

  const head = (label: string, align: "left" | "right" = "right") => (
    <span class="text-12-regular text-text-weak truncate" style={{ "text-align": align }}>
      {label}
    </span>
  )

  return (
    <div ref={root} role="treegrid" class="flex flex-col min-w-0 min-h-0 h-full text-12-mono tabular-nums">
      <div
        role="row"
        class="grid items-center gap-2 px-3 py-1.5 border-b border-border-weaker-base sticky top-0 bg-background-base"
        style={{ "grid-template-columns": gridTemplate() }}
      >
        {head(language.t("agents.col.agent"), "left")}
        <Show when={has("stage")}>{head(language.t("agents.col.stage"), "left")}</Show>
        <Show when={has("in")}>{head(language.t("agents.col.in"))}</Show>
        <Show when={has("out")}>{head(language.t("agents.col.out"))}</Show>
        <Show when={has("rate")}>{head(language.t("agents.col.rate"))}</Show>
        <Show when={has("cache")}>{head(language.t("agents.col.cache"))}</Show>
        <Show when={has("cost")}>{head(language.t("agents.col.cost"))}</Show>
        <Show when={has("lat")}>{head(language.t("agents.col.lat"))}</Show>
        <Show when={has("spark")}>{head(`${language.t("agents.col.graph")}/${props.window}`, "left")}</Show>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <For each={props.nodes}>
          {(node) => {
            const row = () => node.row
            const selected = () => props.selectedID === row().sessionID
            // Collapsed parents show the branch total so hidden subagent spend stays visible.
            const tin = () => (node.collapsed ? node.rollup.tin : row().tin)
            const tout = () => (node.collapsed ? node.rollup.tout : row().tout)
            const cost = () => (node.collapsed ? node.rollup.cost : row().cost)
            return (
              <div
                role="row"
                tabindex={0}
                data-session-id={row().sessionID}
                aria-selected={selected()}
                aria-level={node.depth + 1}
                aria-expanded={node.hasChildren ? !node.collapsed : undefined}
                title={`${row().directory} · ${row().agent} · ${row().model} · ${row().stage.state}`}
                onClick={() => props.onSelect(row().sessionID)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") props.onSelect(row().sessionID)
                }}
                class="grid items-center gap-2 px-3 py-1 cursor-pointer hover:bg-surface-base-hover"
                classList={{ "bg-surface-base-active": selected() }}
                style={{ "grid-template-columns": gridTemplate() }}
              >
                <span class="flex items-center gap-1.5 min-w-0" style={{ "padding-left": `${node.depth * 16}px` }}>
                  <Show when={node.hasChildren} fallback={<span class="w-4 shrink-0" />}>
                    <button
                      type="button"
                      class="size-4 shrink-0 flex items-center justify-center text-icon-weak-base hover:text-icon-base"
                      aria-label={node.collapsed ? language.t("agents.tree.expand") : language.t("agents.tree.collapse")}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onToggle(row().sessionID)
                      }}
                    >
                      <Icon name={node.collapsed ? "chevron-right" : "chevron-down"} size="small" />
                    </button>
                  </Show>
                  <Pulse kind={row().kind} />
                  <span class="truncate" classList={{ "text-text-strong": row().live, "text-text-base": !row().live }}>
                    <Show when={row().agent}>
                      <span class="text-text-weak">{row().agent} · </span>
                    </Show>
                    {row().title || row().sessionID}
                  </span>
                  <Show when={node.collapsed && node.rollup.descendants > 0}>
                    <span class="shrink-0 px-1 rounded bg-surface-base text-12-regular text-text-weak">
                      +{node.rollup.descendants}
                      <Show when={node.rollup.live - (row().live ? 1 : 0) > 0}>
                        <span style={{ color: SEVERITY_COLOR.green }}> ●{node.rollup.live - (row().live ? 1 : 0)}</span>
                      </Show>
                    </span>
                  </Show>
                </span>
                <Show when={has("stage")}>
                  <span class="text-12-medium truncate" style={{ color: SEVERITY_COLOR[row().stage.severity] }}>
                    {row().stage.state}
                  </span>
                </Show>
                <Show when={has("in")}>
                  <span class="text-right text-text-base">{tok(tin())}</span>
                </Show>
                <Show when={has("out")}>
                  <span class="text-right text-text-base">{tok(tout())}</span>
                </Show>
                <Show when={has("rate")}>
                  <span class="text-right" classList={{ "text-text-strong": row().tps > 0, "text-text-weak": row().tps <= 0 }}>
                    {rateText(row().tps)}
                  </span>
                </Show>
                <Show when={has("cache")}>
                  <span class="text-right text-text-weak">{row().cachePct > 0 ? pctText(row().cachePct) : "—"}</span>
                </Show>
                <Show when={has("cost")}>
                  <span class="text-right" classList={{ "text-text-strong": cost() > 0, "text-text-weak": cost() <= 0 }}>
                    {cost() > 0 ? `$${money(cost())}` : "—"}
                  </span>
                </Show>
                <Show when={has("lat")}>
                  <span class="text-right text-text-weak">{latText(row().lat)}</span>
                </Show>
                <Show when={has("spark")}>
                  <SparkBars data={row().spark} live={row().live} height={14} />
                </Show>
              </div>
            )
          }}
        </For>
        <Show when={props.nodes.length === 0}>
          <div class="px-3 py-6 text-12-regular text-text-weak">{language.t("agents.empty")}</div>
        </Show>
      </div>
    </div>
  )
}
