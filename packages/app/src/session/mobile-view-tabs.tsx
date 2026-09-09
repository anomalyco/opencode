import { For, Show, Suspense, lazy, createEffect, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode/ui/tabs"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useLanguage } from "@/runtime/i18n/language"

const StatusDrawer = lazy(async () => {
  const { StatusDrawer } = await import("@/shell/status/status-drawer")
  return { default: StatusDrawer }
})
const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")
  return { default: MobilePanelDrawer }
})

export function SessionMobileViewTabs(props: {
  current: string
  auxiliary?: JSX.Element
  items: readonly { id: string; title: string; menu?: boolean }[]
  onSelect(value: string): void
  details?: (close: () => void) => JSX.Element
  onDetailsOpenChange?: (open: boolean) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ status: false, details: false })
  createEffect(() => props.onDetailsOpenChange?.(store.details))
  onCleanup(() => props.onDetailsOpenChange?.(false))
  return (
    <div class="relative flex shrink-0 items-center" data-slot="session-mobile-view-navigation">
      <Tabs value={props.current} variant="line" class="!h-auto min-w-0 flex-1" data-slot="session-mobile-view-tabs">
        <Tabs.List aria-label={language.t("session.view.select")} class="!h-9 !gap-0 !px-0">
          <Tabs.Trigger value="session" onClick={() => props.onSelect("session")}>
            {language.t("session.tab.session")}
          </Tabs.Trigger>
          <For each={props.items.filter((item) => !item.menu)}>
            {(item) => (
              <Tabs.Trigger value={item.id} onClick={() => props.onSelect(item.id)}>
                {item.title}
              </Tabs.Trigger>
            )}
          </For>
          {props.auxiliary}
        </Tabs.List>
      </Tabs>
      <Menu appearance="standard" modal={false} placement="bottom-end" gutter={4}>
        <Menu.Trigger
          as={IconButton}
          icon={<Icon name="menu" />}
          variant="ghost-muted"
          size="normal"
          aria-label={language.t("common.moreOptions")}
        />
        <Menu.Portal>
          <Menu.Content>
            <For each={props.items.filter((item) => item.menu)}>
              {(item) => <Menu.Item onSelect={() => props.onSelect(item.id)}>{item.title}</Menu.Item>}
            </For>
            <Show when={props.details}>
              <Menu.Item onSelect={() => setStore("details", true)}>{language.t("session.summary.title")}</Menu.Item>
            </Show>
            <Menu.Item onSelect={() => setStore("status", true)}>{language.t("status.popover.trigger")}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={store.status}>
        <Suspense>
          <StatusDrawer open onOpenChange={(open) => setStore("status", open)} />
        </Suspense>
      </Show>
      <Show when={store.details}>
        <Suspense>
          <MobilePanelDrawer
            title={language.t("session.summary.title")}
            open
            onOpenChange={(open) => setStore("details", open)}
          >
            {props.details?.(() => setStore("details", false))}
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </div>
  )
}
