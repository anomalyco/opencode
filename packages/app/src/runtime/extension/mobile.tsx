import { createMemo, For, lazy, Show, Suspense, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode/ui/tabs"
import { Icon } from "@opencode/ui/icon"
import {
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

/** The narrow-screen view switcher: the conversation, each tab view, and a More drawer with the other views. */
export function MobileViewTabs(props: {
  views: MobileViews
  region: Region
  current: string
  session: MountedSession
  screen: SessionScreen
  sidebar: PanelSidebar
  bottom?: boolean
  onSelect: (key: string) => void
}): JSX.Element {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    loaded: boolean
    drawer: string | undefined
  }>({
    open: false,
    loaded: false,
    drawer: undefined,
  })

  const drawer = createMemo(() => (store.drawer ? props.views.find(store.drawer) : undefined))

  const tab = createMemo(() =>
    props.current === "session" || props.views.tabs().some((entry) => entry.key === props.current)
      ? props.current
      : "more",
  )

  let trigger: HTMLButtonElement | undefined

  return (
    <div
      class="relative flex shrink-0 items-center before:pointer-events-none before:absolute before:inset-x-0 before:h-px before:bg-v2-border-border-base before:content-['']"
      classList={{ "before:top-0": props.bottom, "before:bottom-0": !props.bottom }}
      data-slot="session-mobile-view-navigation"
    >
      <Tabs value={tab()} variant="line" class="!h-auto min-w-0 flex-1" data-slot="session-mobile-view-tabs">
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
          <Show when={props.views.menu().length}>
            <Tabs.Trigger
              value="more"
              ref={(element: HTMLButtonElement) => {
                trigger = element
              }}
              class="min-w-0 flex-1"
              classes={{ button: "w-full justify-center" }}
              aria-haspopup="dialog"
              aria-expanded={store.open}
              onClick={() => setStore({ open: true, loaded: true, drawer: undefined })}
            >
              {language.t("session.tab.more")}
            </Tabs.Trigger>
          </Show>
        </Tabs.List>
      </Tabs>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            title={drawer()?.mobile.title ?? language.t("common.moreOptions")}
            hideHeader
            open={store.open}
            onOpenChange={(open) => setStore("open", open)}
            returnFocus={() => trigger}
          >
            <Show
              when={drawer()}
              keyed
              fallback={
                <div
                  data-slot="session-mobile-view-options"
                  class="flex flex-col gap-0.5 rounded-[6px] bg-v2-background-bg-base p-0.5 shadow-[var(--v2-elevation-raised)] [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01"
                >
                  <For each={props.views.menu().filter((entry) => entry.mobile.kind === "menu")}>
                    {(entry) => (
                      <button
                        type="button"
                        class="flex min-h-11 w-full items-center gap-2 rounded-[4px] py-1 ps-3 pe-2 text-start text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-base hover:bg-[var(--v2-overlay-simple-overlay-hover)] focus-visible:outline-none focus-visible:bg-[var(--v2-overlay-simple-overlay-hover)] aria-pressed:bg-[var(--v2-overlay-simple-overlay-pressed)]"
                        aria-pressed={props.current === entry.key}
                        onClick={() => {
                          props.onSelect(entry.key)
                          setStore("open", false)
                        }}
                      >
                        <Show when={entry.mobile.icon}>
                          {(icon) => <Icon name={icon()} class="shrink-0 text-v2-icon-icon-muted" />}
                        </Show>
                        <span class="min-w-0 flex-1 truncate">{entry.mobile.title}</span>
                        <Show when={props.current === entry.key}>
                          <Icon name="check" class="ms-1 shrink-0 text-v2-icon-icon-muted" />
                        </Show>
                      </button>
                    )}
                  </For>
                  <For each={props.views.menu().filter((entry) => entry.mobile.kind === "drawer")}>
                    {(entry) => (
                      <button
                        type="button"
                        class="flex min-h-11 w-full items-center gap-2 rounded-[4px] py-1 ps-3 pe-2 text-start text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-base hover:bg-[var(--v2-overlay-simple-overlay-hover)] focus-visible:outline-none focus-visible:bg-[var(--v2-overlay-simple-overlay-hover)]"
                        onClick={() => setStore("drawer", entry.key)}
                      >
                        <Show when={entry.mobile.icon}>
                          {(icon) => <Icon name={icon()} class="shrink-0 text-v2-icon-icon-muted" />}
                        </Show>
                        <span class="min-w-0 flex-1 truncate">{entry.mobile.title}</span>
                        <Icon name="chevron-right" class="ms-1 shrink-0 text-v2-icon-icon-muted" />
                      </button>
                    )}
                  </For>
                </div>
              }
            >
              {(entry) => (
                <MobilePanel
                  entry={entry}
                  view={props.session}
                  screen={props.screen}
                  sidebar={props.sidebar}
                  visible={store.open}
                  open={() => props.region.openFor(entry.extension)}
                />
              )}
            </Show>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </div>
  )
}
