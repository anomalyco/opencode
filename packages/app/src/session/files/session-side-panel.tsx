import { For, Show, createMemo, onCleanup } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@opencode/ui/tabs"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { SortableTab } from "./tab"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { createFileTabListSync } from "./file-tab-scroll"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionTabs, type Sizing } from "@/session/helpers"
import { useFile } from "@/workspaces/files/model"
import type { SessionExtensions } from "@/extensions/session"
import { ExtensionPanelContent } from "@/extensions/content"

export function SessionSidePanel(props: {
  extensions: SessionExtensions
  present?: boolean
  size: Sizing
  stacked?: boolean
  mobile?: boolean
}) {
  const language = useLanguage()
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const session = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const extensions = props.extensions
  const opened = () => !!props.mobile || (isDesktop() && session.view().reviewPanel.opened())
  const visible = () => opened() || !!props.present
  const sidebar = () => !props.mobile && isDesktop() && settings.visibility.fileTree() && layout.fileTree.opened()
  const width = () => Math.max(240, layout.fileTree.width())
  const state = createSessionTabs({
    tabs: session.tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: file.tab,
    extensions: extensions.keys,
    defaultPanel: extensions.defaultPanel,
    canClose: extensions.canClose,
  })
  const panelTabs = createMemo(() => {
    const keys = state.panelTabs()
    const preferred = extensions.defaultPanel()
    return preferred && !keys.includes(preferred) ? [preferred, ...keys] : keys
  })
  let tabList: HTMLDivElement | undefined
  return (
    <Show when={(isDesktop() || props.mobile) && session.params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!opened() && !sidebar()}
        inert={!opened() && !sidebar()}
        class="relative min-w-0 h-full flex overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
        classList={{
          "flex-1": visible(),
          "min-h-0": !!props.stacked,
          "shrink-0": !props.stacked,
          "pointer-events-none": !opened() && !sidebar(),
        }}
        style={{ width: visible() ? "auto" : sidebar() ? `${width()}px` : "0px" }}
      >
        <Show when={visible()}>
          <div class="relative min-w-0 h-full flex-1 overflow-hidden">
            <DragDropProvider
              sensors={[
                PointerSensor.configure({
                  activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                  preventActivation: (event) =>
                    event.target instanceof Element &&
                    !!event.target.closest('[data-slot="tabs-trigger-close-button"]'),
                }),
              ]}
              modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => tabList ?? null })]}
              plugins={(defaults) => [
                ...defaults.filter((plugin) => plugin !== Accessibility),
                AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
                Feedback.configure({ dropAnimation: null }),
              ]}
              onDragEnd={(event) => {
                const source = event.operation.source
                if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                session.tabs().move(source.id.toString(), source.index)
              }}
            >
              <Tabs value={state.activeTab()} onChange={(value) => session.tabs().setActive(value)}>
                <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
                  <Tabs.List
                    ref={(element: HTMLDivElement) => {
                      tabList = element
                      onCleanup(createFileTabListSync({ el: element, contextOpen: state.contextOpen }))
                    }}
                  >
                    <div class="session-review-v2-sidebar-toggle-slot h-full shrink-0 sticky start-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                      {extensions.toolbar()}
                    </div>
                    <For each={panelTabs()}>
                      {(key) => (
                        <Show when={extensions.panels().find((panel) => panel.key === key)}>
                          {(panel) => (
                            <SortableTab
                              tab={key}
                              index={session.tabs().all().indexOf(key)}
                              temporary={panel().props.temporary}
                              onTabClose={panel().props.closable === false ? undefined : session.tabs().close}
                              onTabDoubleClick={panel().props.onDoubleClick}
                            >
                              <div class="flex items-center gap-1.5">
                                <Show when={panel().props.loading} fallback={panel().icon()}>
                                  <Loader />
                                </Show>
                                <span class="max-w-40 truncate" dir="auto">
                                  {panel().props.title}
                                </span>
                                <Show when={panel().props.badge}>{panel().props.badge}</Show>
                              </div>
                            </SortableTab>
                          )}
                        </Show>
                      )}
                    </For>
                    <Show when={extensions.hasActions()}>
                      <div class="h-full shrink-0 sticky end-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                        <Tooltip value={language.t("session.tab.add")} placement="bottom" class="flex items-center">
                          <Menu appearance="standard" modal={false} placement="bottom-end" gutter={4}>
                            <Menu.Trigger
                              as={IconButton}
                              icon={<Icon name="plus" />}
                              variant="ghost-muted"
                              size="large"
                              aria-label={language.t("session.tab.add")}
                              onPointerDown={(event: PointerEvent) => event.preventDefault()}
                            />
                            <Menu.Portal>
                              <Menu.Content>{extensions.actions()}</Menu.Content>
                            </Menu.Portal>
                          </Menu>
                        </Tooltip>
                      </div>
                    </Show>
                  </Tabs.List>
                  <div
                    data-slot="session-side-panel-actions"
                    class="session-review-v2-open-in-app-slot self-start shrink-0 flex items-center gap-2 pe-3"
                    classList={{ "h-[51px]": !!props.stacked, "h-12": !props.stacked }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {extensions.tools()}
                    <Show when={opened() && !props.mobile}>
                      <div class="size-7 shrink-0" aria-hidden />
                    </Show>
                  </div>
                </div>
                <ExtensionPanelContent panels={extensions.panels()} active={state.activeTab()} />
              </Tabs>
            </DragDropProvider>
          </div>
        </Show>
        <Show when={sidebar()}>
          <div
            id="file-tree-panel"
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            style={{ width: `${width()}px` }}
          >
            {extensions.sidebar()}
            <div onPointerDown={() => props.size.start()}>
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={width()}
                min={240}
                max={480}
                onResize={(width) => {
                  props.size.touch()
                  layout.fileTree.resize(width)
                }}
              />
            </div>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
