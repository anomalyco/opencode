import { For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Mark } from "@opencode-ai/ui/logo"
import { SessionReviewV2SidebarToggle } from "@opencode-ai/ui/v2/session-review-v2"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTabV2, FileVisual } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { getFilename } from "@opencode-ai/core/util/path"
import { decode64 } from "@/utils/base64"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { FilesPanelV2Sidebar } from "@/pages/session/v2/files-panel-v2"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { ReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"

export function SessionSidePanelV2(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewSidebar: () => JSX.Element
  reviewV2State: ReviewPanelV2State
  reviewSnap: boolean
  size: Sizing
}) {
  const settings = useSettings()
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const { sessionKey, tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const open = createMemo(() => reviewOpen())
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    return "auto"
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const showAllFiles = () => {}

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const projectName = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const onReviewTab = () => activeTab() === "review" && props.canReview()

  const reviewTabLabel = () => {
    if (props.hasReview()) {
      return language.t("session.review.filesChangedTab", { count: props.reviewCount() })
    }
    return language.t("session.review.change.other")
  }

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
          "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": settings.general.newLayoutDesigns(),
          "flex-1": reviewOpen(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={open()}>
          <div class="size-full flex">
            <div
              aria-hidden={!reviewOpen()}
              inert={!reviewOpen()}
              class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
              classList={{
                "pointer-events-none": !reviewOpen(),
              }}
            >
              <div class="size-full min-w-0 h-full bg-background-base">
                <DragDropProvider
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  collisionDetector={closestCenter}
                >
                  <DragDropSensors />
                  <ConstrainDragYAxis />
                  <TabsV2
                    variant="pill"
                    value={activeTab()}
                    onChange={openTab}
                    class="session-review-v2-tabs flex flex-col h-full min-h-0"
                  >
                    <div class="session-review-v2-tabs-bar">
                      <Show when={reviewTab() && props.canReview() && reviewOpen()}>
                        <div class="session-review-v2-sidebar-toggle-slot">
                          <SessionReviewV2SidebarToggle
                            opened={props.reviewV2State.sidebarOpened()}
                            onToggle={props.reviewV2State.toggleSidebar}
                          />
                        </div>
                      </Show>
                      <TabsV2.List
                        class="session-review-v2-tabs-list"
                        ref={(el: HTMLDivElement) => {
                          const stop = createFileTabListSync({ el, contextOpen })
                          onCleanup(stop)
                        }}
                      >
                        <Show when={reviewTab() && props.canReview()}>
                          <TabsV2.Trigger value="review">
                            <div>{reviewTabLabel()}</div>
                          </TabsV2.Trigger>
                        </Show>
                        <Show when={contextOpen()}>
                          <TabsV2.Trigger value="context" onMiddleClick={() => tabs().close("context")}>
                            <div class="flex items-center gap-2">
                              <SessionContextUsage variant="indicator" />
                              <div>{language.t("session.tab.context")}</div>
                            </div>
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <TabsV2.CloseButton onClick={() => tabs().close("context")} />
                            </TooltipKeybind>
                          </TabsV2.Trigger>
                        </Show>
                        <SortableProvider ids={openedTabs()}>
                          <For each={openedTabs()}>
                            {(tab) => <SortableTabV2 tab={tab} onTabClose={tabs().close} />}
                          </For>
                        </SortableProvider>
                        <div class="session-review-v2-tabs-actions shrink-0 sticky right-0 z-10 flex items-center justify-center">
                          <TooltipV2
                            placement="bottom"
                            value={language.t("command.file.open")}
                            class="flex items-center"
                          >
                            <IconButtonV2
                              variant="ghost-muted"
                              size="large"
                              icon={<IconV2 name="plus" size="small" />}
                              onClick={() => {
                                void import("@/components/dialog-select-file").then((x) => {
                                  dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                                })
                              }}
                              aria-label={language.t("command.file.open")}
                            />
                          </TooltipV2>
                        </div>
                      </TabsV2.List>
                      <OpenInAppV2 directory={projectDirectory} />
                    </div>

                    <div class="session-review-v2-panel-body">
                      <Show when={onReviewTab()}>{props.reviewSidebar()}</Show>
                      <Show when={!onReviewTab()}>
                        <FilesPanelV2Sidebar
                          title={projectName()}
                          state={props.reviewV2State}
                          diffs={props.diffs}
                          activeFile={activeFileTab()}
                          onOpenFile={(path) => openTab(file.tab(path))}
                        />
                      </Show>
                      <div class="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                        <Show when={reviewTab() && props.canReview()}>
                          <TabsV2.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                            <Show when={reviewOpen() && activeTab() === "review"}>{props.reviewPanel()}</Show>
                          </TabsV2.Content>
                        </Show>

                        <TabsV2.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={activeTab() === "empty"}>
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                                <Mark class="w-14 opacity-10" />
                                <div class="text-14-regular text-text-weak max-w-56">
                                  {language.t("session.files.selectToOpen")}
                                </div>
                              </div>
                            </div>
                          </Show>
                        </TabsV2.Content>

                        <Show when={contextOpen()}>
                          <TabsV2.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                            <Show when={activeTab() === "context"}>
                              <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                                <SessionContextTab />
                              </div>
                            </Show>
                          </TabsV2.Content>
                        </Show>

                        <Show when={activeFileTab()} keyed>
                          {(tab) => <FileTabContent tab={tab} />}
                        </Show>
                      </div>
                    </div>
                  </TabsV2>
                  <DragOverlay>
                    <Show when={store.activeDraggable} keyed>
                      {(tab) => {
                        const path = file.pathFromTab(tab)
                        return (
                          <div data-component="tabs-v2-drag-preview">
                            <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                          </div>
                        )
                      }}
                    </Show>
                  </DragOverlay>
                </DragDropProvider>
              </div>
            </div>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
