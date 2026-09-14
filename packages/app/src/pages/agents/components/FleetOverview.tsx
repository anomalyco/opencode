import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { money, tok } from "../lib/format"
import type { CostBreakdown } from "../lib/cost"

const NARROW_STAT_GRID = 360

/** Right pane when nothing is selected: spend and burn across the fleet. */
export default function FleetOverview(props: { cost: CostBreakdown; totalCost: number; window: string }): JSX.Element {
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

  const statCols = () => (width() > 0 && width() < NARROW_STAT_GRID ? "grid-cols-1" : "grid-cols-2")

  const stat = (label: string, value: string) => (
    <div class="flex flex-col gap-0.5 rounded-md bg-surface-base px-3 py-2 min-w-0">
      <span class="text-12-regular text-text-weak truncate">{label}</span>
      <span class="text-14-mono tabular-nums text-text-strong truncate">{value}</span>
    </div>
  )
  return (
    <div ref={root} class="flex flex-col gap-4 h-full min-h-0 min-w-0 overflow-y-auto p-4">
      <div class="text-14-medium text-text-strong">{language.t("agents.cost.title")}</div>
      <div class="grid gap-2" classList={{ "grid-cols-1": statCols() === "grid-cols-1", "grid-cols-2": statCols() === "grid-cols-2" }}>
        {stat(language.t("agents.cost.window", { window: props.window }), `$${money(props.cost.window.cost)}`)}
        {stat(language.t("agents.cost.rate"), `$${money(props.cost.window.costPerHour)}/h`)}
        {stat(language.t("agents.cost.tokens"), `${tok(props.cost.window.tokensPerMin)}/min`)}
        {stat(language.t("agents.cost.total"), `$${money(props.totalCost)}`)}
      </div>
      <div class="flex flex-col min-w-0">
        <div
          class="grid gap-2 py-1 border-b border-border-weaker-base text-12-regular text-text-weak"
          style={{ "grid-template-columns": "minmax(0,1fr) 72px 64px 72px" }}
        >
          <span>{language.t("agents.cost.model")}</span>
          <span class="text-right">{props.window} $</span>
          <span class="text-right">{props.window} tok</span>
          <span class="text-right">{language.t("agents.cost.allLoaded")}</span>
        </div>
        <For each={props.cost.byModel}>
          {(entry) => (
            <div
              class="grid gap-2 py-1 text-12-mono tabular-nums"
              style={{ "grid-template-columns": "minmax(0,1fr) 72px 64px 72px" }}
            >
              <span class="truncate text-text-base" title={`${entry.provider}/${entry.model}`}>
                <span class="text-text-weak">{entry.provider}/</span>
                {entry.model}
              </span>
              <span class="text-right" classList={{ "text-text-strong": entry.windowCost > 0, "text-text-weak": entry.windowCost <= 0 }}>
                {entry.windowCost > 0 ? `$${money(entry.windowCost)}` : "—"}
              </span>
              <span class="text-right text-text-weak">{entry.windowTokens > 0 ? tok(entry.windowTokens) : "—"}</span>
              <span class="text-right text-text-base">${money(entry.cost)}</span>
            </div>
          )}
        </For>
        <Show when={props.cost.byModel.length === 0}>
          <div class="py-3 text-12-regular text-text-weak">{language.t("agents.cost.none")}</div>
        </Show>
      </div>
      <div class="text-12-regular text-text-weak">{language.t("agents.cost.note")}</div>
    </div>
  )
}
