import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Tabs } from "@opencode/ui/tabs"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Mark } from "@opencode/ui/logo"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Menu } from "@opencode/ui/menu"
import {
  type MountedSession,
  type SessionScreen,
  type PanelSidebar,
  type SessionPanelMenuItem,
} from "@opencode/plugin/gui"
import { useCommand } from "@/shell/commands/command"
import { guardClosingFocus } from "@/shell/panel-motion"
import { useLanguage } from "@/runtime/i18n/language"
import { same } from "@/runtime/persistence/equality"
import { useLayout } from "@/shell/state/layout"
import { useSessionLayout } from "@/session/session-layout"
import type { Sizing } from "@/session/helpers"
import { PanelTrigger } from "./panel-trigger"
import { createSessionPanelMenuEntries, type SessionPanelMenuEntry } from "./panel-menu"
import { RegionContent, type Region, type RegionPane } from "./panels"
import { PluginSlot } from "./render"
import { createTabStripScroll } from "./tab-strip-scroll"
import { closedTabsModifier, type ClosedSideTab } from "./closed-tabs"
import { ClosedTabsSection, NewTabButton } from "./closed-tabs-view"
import type { PaneDrag } from "./pane-drag"

const PANE_HEIGHT_MIN = 120

/** The side region: the side pane, the pane split below it, and the inner sidebar. */
export function SideRegion(props: {
  view: MountedSession
  screen: SessionScreen
  region: Region
  sidebar: PanelSidebar
  present?: boolean
  size: Sizing
  drag: PaneDrag
}) {
  const layout = useLayout()
  const language = useLanguage()
  const { view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const tabsOpen = createMemo(() => isDesktop() && view().side.opened())
  const tabsVisible = createMemo(() => tabsOpen() || !!props.present)
  // Once shown, the contents stay mounted while the region is hidden, so reopening doesn't rebuild them mid-flight.
  const contentMounted = createMemo<boolean>((mounted) => mounted || tabsVisible(), false)
  const panelWidth = createMemo(() => (tabsVisible() ? "auto" : "0px"))

  // Opening the side region with no tabs shows a new tab view, once per opening and session. Keyed by the session, not
  // the item, whose object changes with every routed session.
  const starting = createMemo(() =>
    tabsOpen() && layout.ready() && props.region.empty() ? props.view.key : undefined,
  )

  createEffect(on(starting, (key) => key && props.region.openNewTab("side")))

  // The split pane shows while it holds tabs; when the side pane has none, the split pane takes the whole height.
  const panes = createMemo(() => {
    const split = props.region.pane("split").keys().length > 0

    if (!split) return ["side"] as const

    if (props.region.pane("side").keys().length === 0) return ["split"] as const

    return ["side", "split"] as const
  })

  const [column, setColumn] = createStore({ height: 0 })
  const [root, setRoot] = createSignal<HTMLElement>()
  let stack: HTMLDivElement | undefined

  createResizeObserver(
    () => stack,
    ({ height }) => setColumn({ height }),
  )

  const lowerHeight = createMemo(() => Math.round(column.height * (1 - view().split.ratio())))

  guardClosingFocus({
    root,
    closing: () => !tabsOpen() && tabsVisible(),
    target: () => document.querySelector<HTMLElement>('[data-slot="session-review-toggle"] button') ?? undefined,
  })

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        ref={setRoot}
        id="review-panel"
        tabIndex={-1}
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!tabsOpen()}
        data-focused={props.region.focus.focused() || undefined}
        class="relative h-full shrink-0 min-w-0 flex overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)] outline-none"
        classList={{ "flex-1": tabsVisible() }}
        style={{ width: panelWidth() }}
      >
        {/* Takes the pointer while the panel closes. Inherited pointer-events or inert would restyle every element in
            the panel when they flip; once closed, the screen skips the region with content-visibility instead. */}
        <div class="absolute inset-0 z-50" classList={{ hidden: tabsOpen() || !tabsVisible() }} />
        <Show when={contentMounted()}>
          <div
            data-slot="session-review-content"
            class="h-full flex shrink-0 contain-strict"
            style={{ width: "var(--panel-hold-width, var(--session-side-content-width, 100%))" }}
          >
            <div
              ref={stack}
              class="relative min-w-0 h-full flex-1 flex flex-col overflow-hidden bg-v2-background-bg-base"
            >
              <For each={panes()}>
                {(pane, index) => (
                  <div
                    data-slot="session-side-pane"
                    data-pane={pane}
                    class="relative min-h-0 min-w-0 bg-v2-background-bg-base"
                    classList={{
                      "flex-1": panes().length === 1 || index() === 0,
                      "shrink-0 border-t border-v2-border-border-base": index() > 0,
                    }}
                    style={index() > 0 ? { height: `${lowerHeight()}px` } : undefined}
                  >
                    <Show when={index() > 0}>
                      <div onPointerDown={() => props.size.start()}>
                        <ResizeHandle
                          direction="vertical"
                          edge="start"
                          size={lowerHeight()}
                          min={PANE_HEIGHT_MIN}
                          max={Math.max(PANE_HEIGHT_MIN, column.height - PANE_HEIGHT_MIN)}
                          onResize={(height) => {
                            props.size.touch()

                            if (column.height > 0) view().split.resize(1 - height / column.height)
                          }}
                        />
                      </div>
                    </Show>
                    <PaneTabs
                      pane={props.region.pane(pane)}
                      region={props.region}
                      view={props.view}
                      screen={props.screen}
                      sidebar={props.sidebar}
                      shown={tabsOpen}
                      present={tabsVisible}
                      animate={() => !props.size.active()}
                      placeholder={index() === 0}
                      actions={index() === 0}
                      drag={props.drag}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </aside>
    </Show>
  )
}

/** One pane: its tab strip with the "+" menu, the new tab view, and the tab it shows. */
export function PaneTabs(props: {
  pane: RegionPane
  region: Region
  view: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  /** The pane is on screen. */
  shown: Accessor<boolean>
  /** The pane stays rendered, e.g. while it animates closed. */
  present: Accessor<boolean>
  animate: Accessor<boolean>
  drag: PaneDrag
  /** Shows the empty state while the pane selects nothing. */
  placeholder?: boolean
  /** Renders the plugins' strip actions and keeps room for the session's review toggle. */
  actions?: boolean
  /** Controls after the strip, e.g. the bottom pane's hide button. */
  end?: JSX.Element
}) {
  const language = useLanguage()
  const { tabs } = useSessionLayout()
  const menu = createSessionPanelMenuEntries()
  const primary = createMemo(() => menu().find((entry) => entry.item.primary)?.item)
  const launchers = createMemo(() => menu().filter((entry) => !entry.item.primary && !entry.item.opened))

  // The next tab this pane's "+" menu opens lands in this pane.
  const target = () => tabs().target(props.pane.id)

  const closed = {
    get entries() {
      return props.region.recent()
    },
    onReopen: (key: string) => {
      target()
      props.region.reopen(key)
    },
  }

  const modifier = closedTabsModifier()

  // The tab a right click opened the tab menu on, and where. One menu serves the strip: a menu around each trigger
  // would register the tab in the menu's item collection instead of the strip's.
  const [tabMenu, setTabMenu] = createStore({ open: false, key: "", x: 0, y: 0 })

  const closable = createMemo(() =>
    props.pane.keys().filter((key) => {
      const tab = props.region.entry(key)?.tab

      return !!tab && !tab.pinned && tab.closable !== false
    }),
  )

  // Without a new tab item, "+" opens a host-owned new tab view listing the launchers, as ⌘T does inside the region.
  const current = createMemo(() => props.region.shownNewTab(props.pane.id))
  const add = () => props.region.openNewTab(props.pane.id)

  let selectionEvent: Event | undefined

  return (
    <Tabs
      data-pane-content={props.pane.id}
      value={current()?.id ?? props.pane.active() ?? "empty"}
      onChange={(value) => {
        if (props.region.newTabs(props.pane.id).some((entry) => entry.id === value))
          return props.region.selectNewTab(props.pane.id, value)

        // Kobalte selects the first tab while triggers register, including while the "+" menu's click is still
        // dispatching. Persist input events on a tab only; the region owns fallback selection.
        if (
          selectionEvent &&
          selectionEvent.eventPhase !== Event.NONE &&
          selectionEvent.target instanceof Element &&
          selectionEvent.target.closest('[role="tab"]')
        ) {
          props.region.newTabs(props.pane.id).forEach((entry) => props.region.dismissNewTab(entry.id))
          props.region.select(value)
        }
      }}
    >
      <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
        <Tabs.List
          data-pane-strip={props.pane.id}
          ref={(el: HTMLDivElement) => {
            createEventListener(el, ["pointerdown", "click", "keydown"], (event) => (selectionEvent = event), {
              capture: true,
            })
            onCleanup(createTabStripScroll({ el, lead: props.pane.lead }))
          }}
          onContextMenu={(event: MouseEvent) => {
            const key =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-pane-tab]")?.dataset.paneTab
                : undefined

            // A label's own context menu, such as a terminal's, handles the click first.
            if (!key || event.defaultPrevented) return
            event.preventDefault()
            setTabMenu({ open: true, key, x: event.clientX, y: event.clientY })
          }}
        >
          <For each={props.pane.keys()}>
            {(key) => (
              <Show when={props.region.entry(key)}>
                {(entry) => (
                  <PanelTrigger
                    value={key}
                    plugin={entry().plugin}
                    tab={entry().tab}
                    session={props.view}
                    active={props.pane.active() === key}
                    preview={tabs().preview() === key}
                    dragging={props.drag.dragging() === key}
                    onDragStart={(event) => props.drag.start(event, key, entry().tab.title)}
                    onClose={props.region.close}
                    onPromote={(value) => void tabs().open(value)}
                  />
                )}
              </Show>
            )}
          </For>
          <For each={props.region.newTabs(props.pane.id)}>
            {(entry) => (
              <Tabs.Trigger
                value={entry.id}
                class="group"
                onMiddleClick={() => props.region.dismissNewTab(entry.id)}
                closeButton={
                  <IconButton
                    size="small"
                    variant="ghost-muted"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      props.region.dismissNewTab(entry.id)
                    }}
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("common.closeTab")}
                  />
                }
                hideCloseButton
              >
                {language.t("session.tab.new")}
              </Tabs.Trigger>
            )}
          </For>
          <div class="h-full shrink-0 sticky end-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
            <Show
              when={primary() ?? (launchers().length === 0 && menu().length === 1 ? menu()[0]?.item : undefined)}
              fallback={
                <Show
                  when={launchers().length > 0}
                  fallback={
                    <Show when={menu().length > 1}>
                      <AddMenu items={menu()} onChoose={target} />
                    </Show>
                  }
                >
                  <Show
                    when={modifier}
                    fallback={
                      <Tooltip value={language.t("session.tab.add")} placement="bottom" class="flex items-center">
                        <IconButton
                          icon={<Icon name="plus" />}
                          variant="ghost-muted"
                          size="large"
                          onClick={add}
                          aria-label={language.t("session.tab.add")}
                        />
                      </Tooltip>
                    }
                  >
                    {(key) => (
                      <NewTabButton
                        modifier={key()}
                        entries={closed.entries}
                        onReopen={closed.onReopen}
                        onNewTab={add}
                      />
                    )}
                  </Show>
                </Show>
              }
            >
              {(item) => <AddButton item={item()} onChoose={target} />}
            </Show>
          </div>
        </Tabs.List>
        <Menu
          open={tabMenu.open}
          onOpenChange={(open) => setTabMenu("open", open)}
          modal={false}
          placement="bottom-start"
          gutter={0}
          getAnchorRect={() => ({ x: tabMenu.x, y: tabMenu.y, width: 0, height: 0 })}
        >
          <Menu.Portal>
            <Menu.Content>
              <Menu.Item disabled={!closable().includes(tabMenu.key)} onSelect={() => props.region.close(tabMenu.key)}>
                {language.t("common.closeTab")}
              </Menu.Item>
              <Menu.Item
                disabled={!closable().some((key) => key !== tabMenu.key)}
                onSelect={() => {
                  const keep = tabMenu.key

                  closable().forEach((key) => key !== keep && props.region.close(key))
                }}
              >
                {language.t("session.tab.closeOthers")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
        <div
          data-slot="session-side-panel-actions"
          class="session-review-v2-open-in-app-slot h-[var(--tabs-bar-height)] shrink-0 flex items-center gap-2 pe-3"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Show when={props.actions}>
            <PluginSlot
              at="session.panel.end"
              input={{
                get session() {
                  return props.view
                },
                get screen() {
                  return props.screen
                },
              }}
            />
          </Show>
          {props.end}
          <Show when={props.actions && props.present()}>
            <div class="size-7 shrink-0" aria-hidden />
          </Show>
        </div>
      </div>

      <Show when={current()}>
        {(entry) => (
          <Tabs.Content value={entry().id} class="flex flex-col h-full overflow-hidden contain-strict">
            <Launchers items={launchers()} onChoose={target} closed={closed} />
          </Tabs.Content>
        )}
      </Show>
      <Show when={props.placeholder && !current() && props.pane.active() === undefined}>
        <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
          {/* After + runs a primary item, its tab owns the empty pane until it arrives. The launchers list only in a
              New tab, not in a pane with no tabs. */}
          <Show when={!primary()}>
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                <Mark class="w-14 opacity-10" />
                <div class="text-14-regular text-text-weak max-w-56">{language.t("session.files.selectToOpen")}</div>
              </div>
            </div>
          </Show>
        </Tabs.Content>
      </Show>
      {/* Kept mounted under the new tab view, so terminals and editors keep their state. */}
      <div class="contents" classList={{ hidden: !!current() }} inert={!!current() || undefined}>
        <RegionContent
          pane={props.pane}
          view={props.view}
          screen={props.screen}
          frame={{
            shown: () => props.shown() && !current(),
            present: props.present,
            placement: () => "side",
            reserve: () => false,
            animate: props.animate,
            sidebar: props.sidebar,
          }}
        />
      </div>
    </Tabs>
  )
}

function AddButton(props: { item: SessionPanelMenuItem; onChoose: () => void }): JSX.Element {
  const command = useCommand()
  const keybind = createMemo(() => (props.item.keybind ? command.keybindParts(props.item.keybind) : []))

  return (
    <Tooltip
      value={
        <>
          {props.item.title}
          <Show when={keybind().length > 0}>
            <Keybind keys={keybind()} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      class="flex items-center"
    >
      <IconButton
        icon={<Icon name="plus" />}
        variant="ghost-muted"
        size="large"
        onClick={() => {
          props.onChoose()
          props.item.run()
        }}
        aria-label={props.item.title}
      />
    </Tooltip>
  )
}

function AddMenu(props: { items: readonly SessionPanelMenuEntry[]; onChoose: () => void }): JSX.Element {
  const language = useLanguage()
  const command = useCommand()
  const keys = createMemo(() => props.items.map((entry) => entry.key), [], { equals: same })
  const byKey = createMemo(() => new Map(props.items.map((entry) => [entry.key, entry.item])))
  // A chosen item runs once the closing menu has returned focus to "+", and the tab strip has passed it on to the
  // selected tab. Releasing that focus first lets the item move it where its tab needs it, e.g. into a new terminal,
  // without the strip taking it back for the tab it remembers.
  let chosen: SessionPanelMenuItem | undefined

  return (
    <Tooltip value={language.t("session.tab.add")} placement="bottom" class="flex items-center">
      <Menu appearance="standard" modal={false} placement="bottom-start" gutter={4}>
        <Menu.Trigger
          as={IconButton}
          icon={<Icon name="plus" />}
          variant="ghost-muted"
          size="large"
          aria-label={language.t("session.tab.add")}
          // The tablist redirects focus entering it to the selected
          // tab, which counts as focus-outside and closes the menu.
          onPointerDown={(event: PointerEvent) => event.preventDefault()}
        />
        <Menu.Portal>
          <Menu.Content
            onCloseAutoFocus={() => {
              const item = chosen

              if (!item) return
              chosen = undefined
              setTimeout(() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                props.onChoose()
                item.run()
              })
            }}
          >
            <For each={keys()}>
              {(key) => (
                <Show when={byKey().get(key)}>
                  {(item) => {
                    const keybind = createMemo(() => {
                      const bind = item().keybind

                      return bind ? command.keybindParts(bind) : []
                    })

                    return (
                      <Menu.Item
                        class="!gap-6"
                        onSelect={() => (chosen = item())}
                        shortcut={
                          <Show when={keybind().length > 0}>
                            <Keybind keys={keybind()} variant="neutral" />
                          </Show>
                        }
                      >
                        <div class="flex items-center gap-2">
                          <Show when={item().icon}>{(icon) => <Icon name={icon()} size="small" />}</Show>
                          <span>{item().title}</span>
                        </div>
                      </Menu.Item>
                    )
                  }}
                </Show>
              )}
            </For>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Tooltip>
  )
}

/** The + menu items as rows, then the session's recently closed tabs, in the new tab view. */
function Launchers(props: {
  items: readonly SessionPanelMenuEntry[]
  onChoose: () => void
  closed: { entries: readonly ClosedSideTab[]; onReopen: (key: string) => void }
}): JSX.Element {
  const keys = createMemo(() => props.items.map((entry) => entry.key), [], { equals: same })
  const byKey = createMemo(() => new Map(props.items.map((entry) => [entry.key, entry.item])))

  return (
    <div class="flex-1 min-h-0 overflow-y-auto px-6">
      <div class="mx-auto flex max-w-[560px] flex-col gap-3 pt-12 pb-10">
        <For each={keys()}>
          {(key) => (
            <Show when={byKey().get(key)}>{(item) => <LauncherRow item={item()} onChoose={props.onChoose} />}</Show>
          )}
        </For>
        <ClosedTabsSection entries={props.closed.entries} onReopen={props.closed.onReopen} />
      </div>
    </div>
  )
}

function LauncherRow(props: { item: SessionPanelMenuItem; onChoose: () => void }): JSX.Element {
  const command = useCommand()
  const keybind = createMemo(() => (props.item.keybind ? command.keybindParts(props.item.keybind) : []))

  return (
    <button
      type="button"
      class="flex h-[41px] w-full items-center justify-between gap-4 rounded-[8px] border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01 px-3.5 text-start hover:bg-v2-background-bg-layer-02"
      // The new tab view stays until the tab the item opens selects itself, so nothing shows in between.
      onClick={() => {
        props.onChoose()
        props.item.run()
      }}
    >
      <span class="flex min-w-0 items-center gap-2 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
        <Show when={props.item.icon}>
          {(icon) => <Icon name={icon()} size="small" class="text-v2-icon-icon-muted" />}
        </Show>
        <span class="shrink-0 text-v2-text-text-base">{props.item.title}</span>
        <Show when={props.item.description}>
          {(description) => <span class="truncate text-v2-text-text-muted">{description()}</span>}
        </Show>
      </span>
      <Show when={keybind().length > 0}>
        <Keybind keys={keybind()} variant="neutral" />
      </Show>
    </button>
  )
}
