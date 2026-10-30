// The trading product's own sidebar navigation: one row per dashboard section. This module is
// intentionally light (no SDK, no engine imports) so the titlebar can render it inside the
// sidebar without dragging the trading route's heavy chunk.
import { For } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout, type TradingSection } from "@/shell/state/layout"

export const TRADING_SECTIONS: ReadonlyArray<{ readonly id: TradingSection; readonly icon: string }> = [
  { id: "account", icon: "status" },
  { id: "systems", icon: "play" },
  { id: "positions", icon: "trading-chart" },
  { id: "log", icon: "bullet-list" },
  { id: "tasks", icon: "checklist" },
]

/** The i18n key each section's title reads. Kept beside the nav rows so the top bar (the route)
 * and the sidebar never drift apart; the route reuses the same keys for its headings. */
export function tradingSectionKey(section: TradingSection) {
  switch (section) {
    case "account":
      return "trading.account"
    case "systems":
      return "trading.bots"
    case "positions":
      return "trading.positions"
    case "log":
      return "trading.log"
    case "tasks":
      return "trading.tasks"
  }
}

/** The trading product's sidebar rows, replacing OpenCode's nav while the product is active.
 * The rows sit in one `<nav>` landmark, whose label names the product's dashboard — screen
 * readers announce the group instead of the five buttons in a row. */
export function TradingSidebarNav() {
  const language = useLanguage()
  const layout = useLayout()

  return (
    <nav
      aria-label={language.t("trading.nav.aria")}
      class="flex w-full flex-col items-stretch gap-1"
    >
      <For each={TRADING_SECTIONS}>
        {({ id, icon }) => (
          <button
            type="button"
            data-titlebar-tab-action
            data-action="vertical-tabs-trading-section"
            data-section={id}
            data-state={layout.producto.section() === id ? "pressed" : undefined}
            class="group flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] ps-1.5 pe-2 text-[13px] text-v2-text-text-faint hover:text-v2-text-text-base data-[state=pressed]:text-v2-text-text-base"
            style={{ "line-height": "var(--line-height-compact)" }}
            onClick={() => layout.producto.setSection(id)}
            aria-label={language.t(tradingSectionKey(id))}
            aria-current={layout.producto.section() === id ? "page" : undefined}
          >
            <Icon name={icon} class="shrink-0" />
            <span class="min-w-0 truncate">{language.t(tradingSectionKey(id))}</span>
          </button>
        )}
      </For>
    </nav>
  )
}

/** The same five sections as a compact strip for the layouts without the product's own
 * sidebar: a horizontal tab strip and every stacked window (and the phone) render it inside
 * the dashboard's header row, because that crate never shows `TradingSidebarNav` at all. */
export function TradingNavStrip() {
  const language = useLanguage()
  const layout = useLayout()

  return (
    <nav
      aria-label={language.t("trading.nav.aria")}
      class="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar"
    >
      <For each={TRADING_SECTIONS}>
        {({ id, icon }) => (
          <button
            type="button"
            data-action="trading-nav-strip"
            data-section={id}
            data-state={layout.producto.section() === id ? "pressed" : undefined}
            classList={{
              "flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[13px]": true,
              "bg-v2-background-bg-layer-02 text-v2-text-text-base": layout.producto.section() === id,
              "text-v2-text-text-faint hover:bg-v2-background-bg-layer-02": layout.producto.section() !== id,
            }}
            style={{ "line-height": "var(--line-height-compact)" }}
            onClick={() => layout.producto.setSection(id)}
            aria-label={language.t(tradingSectionKey(id))}
            aria-current={layout.producto.section() === id ? "page" : undefined}
          >
            <Icon name={icon} class="shrink-0" />
            <span class="min-w-0 truncate">{language.t(tradingSectionKey(id))}</span>
          </button>
        )}
      </For>
    </nav>
  )
}
