import { createEffect, createMemo, For, on, onMount, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
} from "@opencode/session-ui/v2/session-review-v2"
import {
  Panel,
  PanelContext,
  type PanelFrame,
  type PanelSidebar,
  type PanelTab,
  type SessionView,
} from "@opencode/gui-extensions/sdk"
import { same } from "@/runtime/persistence/equality"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { createSizing } from "@/session/helpers"
import { useSessionLayout } from "@/session/session-layout"
import { useExtensionHost } from "./host"
import { Contribution } from "./render"

type Tabs = Accessor<{
  all(): string[]
  active(): string | undefined
  setAll(all: string[]): void
  setActive(tab: string | undefined): void
  close(tab: string): void
  remap(rewrite: (tab: string) => string): void
}>

export type RegionEntry = {
  readonly key: string
  readonly extension: string
  readonly tab: PanelTab
  readonly provider: Panel
}

export function panelKey(extension: string, id: string) {
  return `${extension}:${id}`
}

const SidebarState = Persistence.struct({
  sidebarOpened: Schema.Boolean,
  sidebarWidth: Schema.Finite.check(
    Schema.isBetween({ minimum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, maximum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX }),
  ),
  expandMode: Schema.Literals(["expand", "collapse"]),
})

/** The inner sidebar preference every side panel shares. The key predates extensions. */
export function createPanelSidebar(): PanelSidebar {
  const [store, setStore, , ready] = persisted(Persist.global("review-panel-v2"), SidebarState, {
    sidebarOpened: true,
    sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
    expandMode: "collapse",
  })
  return {
    opened: () => store.sidebarOpened,
    width: () => store.sidebarWidth,
    transition: ready,
    resize: (width) =>
      setStore(
        "sidebarWidth",
        Math.min(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX, Math.max(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, width)),
      ),
    toggle: () => setStore("sidebarOpened", (opened) => !opened),
  }
}

/** Every panel extensions offer in one region of the routed session, merged with the stored strip. */
export function createRegion(input: { region: Panel["region"]; view: SessionView; tabs: Tabs }) {
  const host = useExtensionHost()
  const stored = () => input.tabs().all()
  const providers = createMemo(() => host.items(Panel).filter((item) => item.value.region === input.region))
  const entries = createMemo(() =>
    providers().flatMap((item) => {
      const prefix = `${item.extension}:`
      const open = stored().flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
      return item.value.list(input.view, open).map(
        (tab): RegionEntry => ({
          key: panelKey(item.extension, tab.id),
          extension: item.extension,
          tab,
          provider: item.value,
        }),
      )
    }),
  )
  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))

  // Rewrites stored keys once their panel is present: keys stored before extensions (e.g. "context") and ids a
  // panel writes more than one way. Duplicates collapse, so one file stored two ways is one tab.
  createEffect(() => {
    const legacy = new Map(
      providers().flatMap((item) =>
        Object.entries(item.value.legacy ?? {}).map(([key, id]) => [key, panelKey(item.extension, id)] as const),
      ),
    )
    const normalizers = providers().flatMap((item) => (item.value.normalize ? [item] : []))
    if (legacy.size === 0 && normalizers.length === 0) return
    const rewrite = (key: string) => {
      const moved = legacy.get(key)
      if (moved) return moved
      const item = normalizers.find((provider) => key.startsWith(`${provider.extension}:`))
      if (!item?.value.normalize) return key
      return panelKey(item.extension, item.value.normalize(key.slice(item.extension.length + 1), input.view))
    }
    // remap reads the stored tabs and writes nothing once every key is canonical, so this settles in one rerun.
    input.tabs().remap(rewrite)
  })

  // Transient panels are not restored: their stored keys leave once the panel stops listing them.
  createEffect(() => {
    const listed = new Set(entries().map((entry) => entry.key))
    const transient = providers().flatMap((item) => (item.value.transient ? [`${item.extension}:`] : []))
    if (transient.length === 0) return
    const all = stored()
    const next = all.filter((key) => listed.has(key) || !transient.some((prefix) => key.startsWith(prefix)))
    if (next.length !== all.length) input.tabs().setAll(next)
  })

  const strip = createMemo(() => {
    const listed = stored().flatMap((key) => {
      const entry = byKey().get(key)
      return entry && entry.tab.kind !== "pinned" ? [entry] : []
    })
    return [
      ...entries().filter((entry) => entry.tab.kind === "pinned"),
      ...listed.filter((entry) => entry.tab.first),
      ...listed.filter((entry) => !entry.tab.first),
    ]
  })

  const active = createMemo(() => {
    const value = input.tabs().active()
    if (value && strip().some((entry) => entry.key === value)) return value
    return strip()
      .filter((entry) => entry.tab.fallback !== undefined)
      .reduce<RegionEntry | undefined>(
        (best, entry) => (!best || entry.tab.fallback! > best.tab.fallback! ? entry : best),
        undefined,
      )?.key
  })

  // The effect's own value marks its first run: the selection the region mounts with, stored or fallback.
  createEffect(
    on(active, (key, _, restored: boolean = true) => {
      const entry = key ? byKey().get(key) : undefined
      if (entry) entry.provider.focus?.(entry.tab, input.view, { restored })
      return false
    }),
  )

  return {
    entries,
    /** Strip order by key. Renders iterate keys so a provider's fresh tab objects never remount a trigger. */
    keys: createMemo(() => strip().map((entry) => entry.key), [], { equals: same }),
    entry: (key: string) => byKey().get(key),
    active,
    selected: createMemo(() => {
      const key = active()
      return key ? byKey().get(key) : undefined
    }),
    wide: createMemo(() => providers().some((item) => item.value.wide)),
    /** An extension's tab ids in the stored strip. */
    openFor: (extension: string) =>
      stored().flatMap((key) => (key.startsWith(`${extension}:`) ? [key.slice(extension.length + 1)] : [])),
    lead: () => !!strip().find((entry) => entry.tab.kind !== "pinned")?.tab.first,
    select(key: string) {
      input.tabs().setActive(key)
    },
    close(key: string) {
      const entry = byKey().get(key)
      input.tabs().close(key)
      if (entry) entry.provider.close?.(entry.tab, input.view)
    },
  }
}

export type Region = ReturnType<typeof createRegion>

/** Grouped content stays mounted while any member is listed; other tabs mount only while selected. */
export function RegionContent(props: {
  region: Region
  view: SessionView
  frame: Omit<PanelFrame, "visible" | "open"> & { shown: Accessor<boolean> }
}) {
  const groups = createMemo(() =>
    Array.from(new Set(props.region.entries().flatMap((entry) => (entry.tab.group ? [groupKey(entry)] : [])))),
  )
  const single = createMemo(() => {
    const entry = props.region.selected()
    return entry && !entry.tab.group ? entry.key : undefined
  })
  return (
    <>
      <For each={groups()}>
        {(group) => {
          const active = () => {
            const entry = props.region.selected()
            return !!entry && groupKey(entry) === group
          }
          // The last selected member keeps rendering while the group is hidden.
          const member = createMemo<RegionEntry | undefined>((previous) => {
            const members = props.region.entries().filter((entry) => groupKey(entry) === group)
            const selected = props.region.selected()
            if (selected && groupKey(selected) === group) return selected
            return members.find((entry) => entry.key === previous?.key) ?? members[0]
          })
          return (
            <Show when={member()?.extension} keyed>
              {(extension) => (
                <div
                  id={member()?.tab.dom?.panel}
                  role="tabpanel"
                  aria-labelledby={active() ? member()?.tab.dom?.tab : undefined}
                  data-slot="tabs-content"
                  class="h-full min-h-0 overflow-hidden"
                  classList={{ hidden: !active() }}
                  inert={!active() || undefined}
                >
                  <PanelContext.Provider
                    value={{
                      ...props.frame,
                      visible: () => props.frame.shown() && active(),
                      open: () => props.region.openFor(extension),
                    }}
                  >
                    <Contribution extension={extension}>
                      {() => member()!.provider.render(() => member()!.tab, props.view)}
                    </Contribution>
                  </PanelContext.Provider>
                </div>
              )}
            </Show>
          )
        }}
      </For>
      <Show when={single()} keyed>
        {(key) => {
          const entry = createMemo(() => props.region.entries().find((item) => item.key === key))
          return (
            <Show when={entry()?.extension} keyed>
              {(extension) => (
                <div
                  id={entry()?.tab.dom?.panel}
                  role="tabpanel"
                  aria-labelledby={entry()?.tab.dom?.tab}
                  tabIndex={entry()?.tab.tabbable ? 0 : undefined}
                  data-slot="tabs-content"
                  class="flex flex-col h-full overflow-hidden contain-strict"
                >
                  <PanelContext.Provider
                    value={{ ...props.frame, visible: props.frame.shown, open: () => props.region.openFor(extension) }}
                  >
                    <Contribution extension={extension}>
                      {() => entry()!.provider.render(() => entry()!.tab, props.view)}
                    </Contribution>
                  </PanelContext.Provider>
                </div>
              )}
            </Show>
          )
        }}
      </Show>
    </>
  )
}

function groupKey(entry: RegionEntry) {
  return `${entry.extension}/${entry.tab.group ?? entry.key}`
}

/** The dock region: host frame, sizing, and resize around the dock panel an extension renders. */
export function DockRegion(props: {
  view: SessionView
  sidebar: PanelSidebar
  stacked?: boolean
  fill?: boolean
  framed?: boolean
  present?: boolean
  contentHeight?: string
  embedded?: boolean
  animate?: boolean
  reserve?: boolean
}) {
  const host = useExtensionHost()
  const { view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const [store, setStore] = createStore({
    viewport: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })
  const entry = createMemo(() =>
    host
      .items(Panel)
      .filter((item) => item.value.region === "dock")
      .flatMap((item) =>
        item.value.list(props.view, []).map(
          (tab): RegionEntry => ({
            key: panelKey(item.extension, tab.id),
            extension: item.extension,
            tab,
            provider: item.value,
          }),
        ),
      )
      .at(0),
  )
  const opened = createMemo(() => view().dock.opened())
  const height = createMemo(() => view().dock.height())
  const max = () => store.viewport * 0.6
  const pane = () => Math.min(height(), max())
  const stacked = createMemo(() => isDesktop() && !!props.stacked)
  const panelHeight = createMemo(() => {
    if (props.fill) return "100%"
    if (!opened()) return "0px"
    if (isDesktop()) return stacked() ? `${pane()}px` : "100%"
    return `${pane()}px`
  })
  const contentHeight = createMemo(
    () => props.contentHeight ?? (isDesktop() ? (stacked() ? `${pane()}px` : "100%") : `${pane()}px`),
  )
  const present = createMemo(() => opened() || !!props.present)
  let root: HTMLElement | undefined

  onMount(() => {
    const sync = () => setStore("viewport", window.visualViewport?.height ?? window.innerHeight)
    sync()
    makeEventListener(window, "resize", sync)
    if (window.visualViewport) makeEventListener(window.visualViewport, "resize", sync)
  })

  createEffect(() => {
    if (opened()) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!root?.contains(active)) return
    active.blur()
  })

  return (
    <aside
      ref={root}
      id="terminal-panel"
      data-component="terminal-panel"
      data-opened={opened()}
      data-size-animated={props.animate !== false && !props.embedded && !size.active() && (!isDesktop() || stacked())}
      role="region"
      aria-label={entry()?.tab.title}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "w-full": !isDesktop() || stacked(),
        "min-w-0 h-full flex-1": isDesktop() && present() && !stacked(),
        "w-0 h-full pointer-events-none": isDesktop() && !present(),
        "rounded-[10px] shadow-[var(--v2-elevation-raised)]": isDesktop() && (props.framed ?? true),
        "will-change-[height]": !props.embedded && !size.active() && (!isDesktop() || stacked()),
      }}
      style={{ height: panelHeight(), "--terminal-panel-height": contentHeight() }}
    >
      <div classList={{ "md:hidden": !stacked(), hidden: stacked() || props.embedded }} onPointerDown={size.start}>
        <ResizeHandle
          class="-top-1"
          direction="vertical"
          size={pane()}
          min={100}
          max={max()}
          collapseThreshold={50}
          onResize={(next) => {
            size.touch()
            view().dock.resize(next)
          }}
          onCollapse={() => view().dock.close()}
        />
      </div>
      <div
        data-slot="terminal-panel-content"
        class="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        classList={{
          "border-t border-border-weak-base": opened() && !isDesktop() && !props.embedded,
          "pointer-events-none": !opened(),
        }}
        style={{ height: contentHeight() }}
      >
        <Show when={entry()?.extension} keyed>
          {(extension) => (
            <PanelContext.Provider
              value={{
                visible: opened,
                present,
                placement: () => (props.embedded ? "mobile" : stacked() ? "bottom" : "side"),
                reserve: () => !!props.reserve,
                animate: () => !size.active(),
                sidebar: props.sidebar,
                open: () => [],
              }}
            >
              <Contribution extension={extension}>
                {() => entry()!.provider.render(() => entry()!.tab, props.view)}
              </Contribution>
            </PanelContext.Provider>
          )}
        </Show>
      </div>
    </aside>
  )
}

/** Renders one panel as a narrow-screen view. */
export function MobilePanel(props: {
  entry: RegionEntry
  view: SessionView
  sidebar: PanelSidebar
  visible: boolean
  open: Accessor<readonly string[]>
}): JSX.Element {
  return (
    <PanelContext.Provider
      value={{
        visible: () => props.visible,
        present: () => props.visible,
        placement: () => "mobile",
        reserve: () => false,
        animate: () => true,
        sidebar: props.sidebar,
        open: props.open,
      }}
    >
      <Contribution extension={props.entry.extension}>
        {() => props.entry.provider.render(() => props.entry.tab, props.view)}
      </Contribution>
    </PanelContext.Provider>
  )
}
