import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useTabs, tabKey, type Tab } from "@/context/tabs"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { TitlebarTabStrip } from "./titlebar-tab-strip"
import {
  createTabRailState,
  TAB_RAIL_COLLAPSED_WIDTH,
  TAB_RAIL_COLLAPSE_THRESHOLD,
  TAB_RAIL_WIDTH_MAX,
  TAB_RAIL_WIDTH_MIN,
} from "./titlebar-tab-rail-state"

/**
 * A resizable left-hand vertical rail hosting the session/draft tab strip.
 * Rendered by layout-new.tsx when `settings.general.tabOrientation ===
 * "vertical"`. In that mode the top header is collapsed to bare window chrome,
 * so this rail owns the home button, tab navigation/reordering, and the
 * new-tab button. Home and new-tab reuse the commands the (still-mounted)
 * titlebar registers (`home.toggle`, `tab.new`) via `command.trigger`, so no
 * titlebar logic is duplicated. Tab state comes from the shared `useTabs()`
 * context.
 *
 * The rail can be resized by dragging its right edge, and collapses to an
 * icon-only strip either by dragging below the collapse threshold or via the
 * toggle button. Collapsed mode needs no special rendering: narrowing each tab
 * slot past 64px triggers the existing `@container` query that hides the title.
 */
export function TitlebarTabRail(props: { side?: "left" | "right" }) {
  const tabs = useTabs()
  const tabsStore = tabs.store
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const rail = createTabRailState()
  const [, setOverflowing] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  // Touch devices have no hover, so a tap latches the collapsed rail open and a
  // second tap (or tapping outside) closes it again.
  const [pinned, setPinned] = createSignal(false)
  const touch = createMediaQuery("(hover: none)")
  let rootEl: HTMLDivElement | undefined

  // On touch, close the tapped-open rail when the next pointer-down lands
  // outside it (focusout is unreliable since tapping content doesn't move
  // focus). Registered lazily only while pinned.
  createEffect(() => {
    if (!pinned()) return
    const onDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootEl?.contains(target)) return
      setPinned(false)
    }
    document.addEventListener("pointerdown", onDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onDown, true))
  })

  const right = () => props.side === "right"

  // Reveal-on-hover for the collapsed rail, with a short close delay so brief
  // pointer excursions (e.g. reaching for the scrollbar) don't cause the rail
  // to flicker shut. Re-entering cancels a pending close.
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const cancelClose = () => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = undefined
  }
  const openHover = () => {
    cancelClose()
    if (rail.collapsed() && !touch()) setHovered(true)
  }
  const scheduleClose = () => {
    if (touch()) return
    cancelClose()
    closeTimer = setTimeout(() => setHovered(false), 250)
  }
  onCleanup(cancelClose)

  // Collapsed rail shows an icon-only strip but reveals its full remembered
  // width on hover (or on tap for touch, via `pinned`). "expanded" means show
  // titles. The remembered width is kept separately in state, so collapsing and
  // re-expanding restores the previous width.
  const expanded = () => !rail.collapsed() || hovered() || pinned()
  const width = () => (expanded() ? rail.width() : TAB_RAIL_COLLAPSED_WIDTH)

  const isHome = createMemo(() => layout.route().type === "home")
  const currentTab = createMemo(() => {
    const route = layout.route()
    if (route.type === "draft") {
      return tabsStore.find((item) => item.type === "draft" && item.draftID === route.draftID)
    }
    if (route.type === "session") {
      return tabsStore.find(
        (item) => item.type === "session" && item.server === route.server && item.sessionId === route.sessionId,
      )
    }
  })

  return (
    <div
      ref={rootEl}
      data-slot="titlebar-tab-rail"
      data-collapsed={rail.collapsed() && !hovered()}
      class="relative flex h-full shrink-0 flex-col gap-1.5 overflow-hidden bg-v2-background-bg-deep py-2"
      classList={{
        "px-2": expanded(),
        "pl-1 pr-0.5": !expanded() && !right(),
        "pr-1 pl-0.5": !expanded() && right(),
      }}
      style={{ width: `${width()}px`, transition: "width 150ms ease" }}
      onPointerEnter={openHover}
      onPointerLeave={scheduleClose}
      onClick={() => {
        // On touch, first tap on the collapsed strip latches it open.
        if (touch() && rail.collapsed() && !pinned()) setPinned(true)
      }}
    >
      <div
        class="flex shrink-0 flex-col gap-1.5"
        classList={{
          "items-center": !expanded(),
          "items-start": expanded() && !right(),
          "items-end": expanded() && right(),
        }}
      >
        <TooltipV2
          placement={right() ? "left" : "right"}
          value={
            <>
              {language.t("home.title")}
              <KeybindV2 keys={command.keybindParts("home.toggle")} variant="neutral" />
            </>
          }
          class="shrink-0"
        >
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            icon={<IconV2 name="grid-plus" />}
            state={isHome() ? "pressed" : undefined}
            onClick={() => tabs.toggleHome({ home: isHome(), current: currentTab() })}
            aria-label={language.t("home.title")}
            aria-pressed={isHome()}
          />
        </TooltipV2>
        <TooltipV2 placement={right() ? "left" : "right"} value={language.t("command.session.new")} class="shrink-0">
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            icon={<IconV2 name="plus" />}
            onClick={() => command.trigger("tab.new")}
            aria-label={language.t("command.session.new")}
          />
        </TooltipV2>
      </div>
      <div class="min-h-0 min-w-0 flex-1 overflow-hidden">
        <TitlebarTabStrip
          tabs={tabsStore}
          currentTab={currentTab}
          forceTruncate={false}
          orientation="vertical"
          side={props.side}
          onOverflowChange={setOverflowing}
          onNavigate={(tab, el) => {
            tabs.select(tab)
            el?.scrollIntoView({ behavior: "instant", block: "nearest" })
          }}
          onClose={(tab) => {
            const index = tabsStore.findIndex((item: Tab) => tabKey(item) === tabKey(tab))
            if (index !== -1) tabs.closeTab(index)
          }}
          onReorder={(keys) => tabs.reorder(keys)}
        />
      </div>
      <div
        class="flex shrink-0"
        classList={{
          "justify-center": !expanded(),
          "justify-start": expanded() && !right(),
          "justify-end": expanded() && right(),
        }}
      >
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="small"
          class="shrink-0"
          icon={<IconV2 name="sidebar-right" />}
          onClick={() => {
            setPinned(false)
            rail.toggleCollapsed()
          }}
          aria-label={language.t(rail.collapsed() ? "tabRail.expand" : "tabRail.collapse")}
        />
      </div>
      <Show when={!rail.collapsed()}>
        <ResizeHandle
          direction="horizontal"
          edge={right() ? "start" : "end"}
          class="absolute inset-y-0 z-10 w-2 cursor-col-resize hover:bg-v2-border-border-muted"
          classList={{ "right-0 -mr-0.5": !right(), "left-0 -ml-0.5": right() }}
          size={rail.width()}
          min={TAB_RAIL_WIDTH_MIN}
          max={TAB_RAIL_WIDTH_MAX}
          collapseThreshold={TAB_RAIL_COLLAPSE_THRESHOLD}
          onResize={rail.resize}
          onCollapse={() => rail.setCollapsed(true)}
        />
      </Show>
    </div>
  )
}
