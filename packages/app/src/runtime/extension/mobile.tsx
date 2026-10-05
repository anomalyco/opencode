import { createMemo, For, lazy, Show, Suspense, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode/ui/tabs"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import {
  DrawerContext,
  Panel,
  type PanelSidebar,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
} from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useExtensionHost } from "./host"
import { panelKey } from "./panel-keys"
import { MobilePanel, type Region, type RegionEntry } from "./panels"

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

export type MobileEntry = RegionEntry & { readonly mobile: NonNullable<Panel["mobile"]> }

/** Panels that offer a narrow-screen view, keyed `${extension}:${panel id}`. */
export function createMobileViews() {
  const host = useExtensionHost()

  const entries = createMemo(() =>
    host.items(Panel).flatMap((item): MobileEntry[] => {
      const mobile = item.value.mobile

      if (!mobile) return []
      const tab: PanelTab = { id: item.value.id, title: mobile.title }

      return [
        { key: panelKey(item.extension, item.value.id), extension: item.extension, tab, provider: item.value, mobile },
      ]
    }),
  )

  const sorted = (kinds: readonly string[]) =>
    entries()
      .filter((entry) => kinds.includes(entry.mobile.kind))
      .toSorted((a, b) => a.mobile.order - b.mobile.order)

  return {
    entries,
    tabs: createMemo(() => sorted(["tab"])),
    menu: createMemo(() => sorted(["menu", "drawer"])),
    find: (key: string) => entries().find((entry) => entry.key === key),
  }
}

export type MobileViews = ReturnType<typeof createMobileViews>

/** The narrow-screen view switcher: the conversation, each panel's view, and an overflow menu. */
export function MobileViewTabs(props: {
  views: MobileViews
  region: Region
  current: string
  session: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  onSelect: (key: string) => void
}): JSX.Element {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    menu: boolean
    drawer: string | undefined
    last: string | undefined
    loaded: boolean
    pending: string | undefined
  }>({
    menu: false,
    drawer: undefined,
    // Keeps the last drawer's content mounted while it animates closed.
    last: undefined,
    loaded: false,
    pending: undefined,
  })

  const drawer = createMemo(() => (store.last ? props.views.find(store.last) : undefined))
  let trigger: HTMLButtonElement | undefined

  return (
    <div
      class="relative flex shrink-0 items-center before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-v2-border-border-base before:content-['']"
      data-slot="session-mobile-view-navigation"
    >
      <Tabs value={props.current} variant="line" class="!h-auto min-w-0 flex-1" data-slot="session-mobile-view-tabs">
        <Tabs.List aria-label={language.t("session.view.select")} class="!h-9 !gap-0 !px-0 before:!hidden">
          <Tabs.Trigger
            value="session"
            class="min-w-0 flex-1"
            classes={{ button: "w-full justify-center" }}
            onClick={() => props.onSelect("session")}
          >
            {language.t("session.tab.session")}
          </Tabs.Trigger>
          <For each={props.views.tabs()}>
            {(entry) => (
              <Tabs.Trigger
                value={entry.key}
                class="min-w-0 flex-1"
                classes={{ button: "w-full justify-center" }}
                onClick={() => props.onSelect(entry.key)}
              >
                {entry.mobile.title}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
      </Tabs>
      <Menu
        appearance="standard"
        modal={false}
        placement="bottom-end"
        gutter={4}
        open={store.menu}
        onOpenChange={(open) => setStore("menu", open)}
      >
        <Menu.Trigger
          as={IconButton}
          ref={(element: HTMLButtonElement) => {
            trigger = element
          }}
          icon={<Icon name="menu" />}
          variant="ghost-muted"
          size="normal"
          class="mx-1.5 shrink-0"
          state={props.views.menu().some((entry) => entry.key === props.current) || store.menu ? "pressed" : undefined}
          aria-label={language.t("common.moreOptions")}
        />
        <Menu.Portal>
          <Menu.Content
            onCloseAutoFocus={(event) => {
              if (!store.pending) return
              event.preventDefault()
              setStore({ drawer: store.pending, last: store.pending, loaded: true, pending: undefined })
            }}
          >
            <For each={props.views.menu()}>
              {(entry) => (
                <Menu.Item
                  onSelect={() => {
                    if (entry.mobile.kind === "menu") return props.onSelect(entry.key)
                    setStore({ pending: entry.key, menu: false })
                  }}
                >
                  {entry.mobile.title}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            title={drawer()?.mobile.title ?? ""}
            open={!!store.drawer}
            onOpenChange={(open) => {
              if (!open) setStore("drawer", undefined)
            }}
            returnFocus={() => trigger}
          >
            <Show when={drawer()} keyed>
              {(entry) => (
                <DrawerContext.Provider value={{ close: () => setStore("drawer", undefined) }}>
                  <MobilePanel
                    entry={entry}
                    view={props.session}
                    screen={props.screen}
                    sidebar={props.sidebar}
                    visible={store.drawer === entry.key}
                    open={() => props.region.openFor(entry.extension)}
                  />
                </DrawerContext.Provider>
              )}
            </Show>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </div>
  )
}
