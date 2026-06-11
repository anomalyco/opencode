import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { createMediaQuery } from "@solid-primitives/media"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Mark } from "@opencode-ai/ui/logo"
import { SessionReviewEmptyOpenFileV2 } from "@opencode-ai/ui/v2/session-review-empty-open-file-v2"
import { SessionReviewV2SidebarToggle } from "@opencode-ai/ui/v2/session-review-v2"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, FileVisual } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { getFilename } from "@opencode-ai/core/util/path"
import { decode64 } from "@/utils/base64"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { FilesPanelV2Sidebar } from "@/pages/session/v2/files-panel-v2"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContentV2 } from "@/pages/session/v2/file-tab-content-v2"
import type { ReviewPanelV2Props } from "@/pages/session/v2/review-panel-v2"
import { SESSION_OPEN_FILE_TAB, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { ReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import { useSessionSidePanelTabsV2 } from "@/pages/session/v2/use-session-side-panel-tabs-v2"

export function SessionSidePanelV2(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewSidebar: () => JSX.Element
  reviewV2State: ReviewPanelV2State
  fileTabReview: () => ReviewPanelV2Props
  reviewSnap: boolean
  size: Sizing
}) {
  const settings = useSettings()
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const { sessionKey, tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!reviewOpen()) return "0px"
    return "auto"
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const tabsV2 = useSessionSidePanelTabsV2({
    tabs,
    tabForPath: file.tab,
    normalizeTab,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabsV2.tabState.contextOpen
  const activeTab = tabsV2.tabState.activeTab
  const activeFileTab = tabsV2.tabState.activeFileTab
  const [focusFilesFilterToken, setFocusFilesFilterToken] = createSignal(0)
  const [tracking, setTracking] = createStore({
    prevActiveTab: undefined as string | undefined,
    prevTemporaryTab: undefined as string | undefined,
    prevHadOpenFileTab: false,
    wasOpenFileTab: false,
    initialized: false,
  })
  const filesSidebarOpen = createMemo(
    () => props.reviewV2State.sidebarOpened() || activeTab() === SESSION_OPEN_FILE_TAB,
  )

  createEffect(() => {
    const currentActiveTab = activeTab()
    const currentTemporaryTab = tabsV2.temporaryTab()
    const currentHadOpenFileTab = tabs().all().includes(SESSION_OPEN_FILE_TAB)
    const isOpenFileTab = currentActiveTab === SESSION_OPEN_FILE_TAB
    if (isOpenFileTab && !tracking.wasOpenFileTab) {
      const shouldClearFilter =
        tracking.initialized &&
        !tracking.prevHadOpenFileTab &&
        tracking.prevActiveTab !== tracking.prevTemporaryTab
      if (shouldClearFilter) props.reviewV2State.setFilesFilter("")
      setFocusFilesFilterToken((token) => token + 1)
    }
    setTracking({
      prevActiveTab: currentActiveTab,
      prevTemporaryTab: currentTemporaryTab,
      prevHadOpenFileTab: currentHadOpenFileTab,
      wasOpenFileTab: isOpenFileTab,
      initialized: true,
    })
  })

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
    const filesChanged = language.t("session.review.filesChangedTab", { count: "" }).trim()
    const count = props.reviewCount()
    if (count <= 0) return filesChanged
    return `${filesChanged} ${count}`
  }

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!reviewOpen()}
        inert={!reviewOpen()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !reviewOpen(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
          "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": settings.general.newLayoutDesigns(),
          "flex-1": reviewOpen(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={reviewOpen()}>
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
                <TabsV2
                  variant="pill"
                  value={activeTab()}
                  onChange={() => {}}
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
                        tabsV2.setTabListRef(el)
                        const stop = createFileTabListSync({ el, contextOpen })
                        onCleanup(stop)
                      }}
                    >
                      <Show when={reviewTab() && props.canReview()}>
                        <TabsV2.Trigger
                          value="review"
                          onPointerDown={(event) => {
                            if (event.button !== 0) return
                            tabsV2.handleTabsChange("review")
                          }}
                        >
                          <div>{reviewTabLabel()}</div>
                        </TabsV2.Trigger>
                      </Show>
                      <Show when={contextOpen()}>
                        <TabsV2.Trigger
                          value="context"
                          onMiddleClick={() => tabs().close("context")}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return
                            tabsV2.handleTabsChange("context")
                          }}
                        >
                          <div class="flex items-center gap-2">
                            <SessionContextUsage variant="indicator" />
                            <div>{language.t("session.tab.context")}</div>
                          </div>
                          <TabsV2.CloseButton onClick={() => tabs().close("context")} />
                        </TabsV2.Trigger>
                      </Show>
                      <For each={tabsV2.visibleStripTabs()}>
                        {(tab) => {
                          const path = () => file.pathFromTab(tab)
                          const placeholder = () => tab === SESSION_OPEN_FILE_TAB
                          const temporary = () => tabsV2.temporaryTab() === tab
                          const dragged = () => tabsV2.drag.active && tabsV2.drag.draggedTab === tab
                          return (
                            <div
                              data-session-tab-slot
                              data-tab-key={tab}
                              class="session-review-v2-file-tab-slot flex shrink-0 items-center touch-none"
                              classList={{
                                "pointer-events-none": tabsV2.drag.active,
                                "invisible": dragged(),
                                "session-review-v2-file-tab-slot--pressed": tabsV2.pressedTab() === tab,
                              }}
                              onPointerDown={(event) => {
                                if (dragged()) return
                                tabsV2.onStripPointerDown(tab, event)
                              }}
                            >
                              <TabsV2.Trigger
                                value={tab}
                                data-session-tab
                                data-temporary={temporary() ? "" : undefined}
                                classList={{ "session-review-v2-file-tab--temporary": temporary() }}
                                onMiddleClick={() => tabsV2.closeTab(tab)}
                                onDblClick={() => {
                                  if (placeholder()) return
                                  tabsV2.persistTab(tab)
                                }}
                              >
                                <Show
                                  when={placeholder()}
                                  fallback={
                                    <Show when={path()}>{(value) => <FileVisual path={value()} textClass="truncate" />}</Show>
                                  }
                                >
                                  <div class="flex items-center gap-1.5">
                                    <IconV2 name="open-file" size="small" />
                                    <div>{language.t("command.file.open")}</div>
                                  </div>
                                </Show>
                                <TabsV2.CloseButton onClick={() => tabsV2.closeTab(tab)} />
                              </TabsV2.Trigger>
                            </div>
                          )
                        }}
                      </For>
                      <div class="session-review-v2-tabs-actions shrink-0 sticky right-0 z-10 flex items-center justify-center">
                        <TooltipV2 placement="bottom" value={language.t("command.file.open")} class="flex items-center">
                          <IconButtonV2
                            variant="ghost-muted"
                            size="large"
                            icon={<IconV2 name="plus" size="small" />}
                            onClick={tabsV2.openPlaceholderTab}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipV2>
                      </div>
                    </TabsV2.List>
                    <OpenInAppV2 directory={projectDirectory} />
                  </div>

                  <div class="session-review-v2-panel-body">
                    <Show
                      when={onReviewTab()}
                      fallback={
                        <FilesPanelV2Sidebar
                          title={projectName()}
                          state={props.reviewV2State}
                          open={filesSidebarOpen()}
                          focusFilterToken={focusFilesFilterToken()}
                          diffs={props.diffs}
                          activeFile={activeFileTab()}
                          onOpenFile={(path) => tabsV2.openFileTab(path)}
                          onOpenFilePersist={(path) => tabsV2.openFileTab(path, { persist: true })}
                        />
                      }
                    >
                      {props.reviewSidebar()}
                    </Show>
                    <div class="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                      <Show when={reviewTab() && props.canReview()}>
                        <TabsV2.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={reviewOpen() && activeTab() === "review"}>{props.reviewPanel()}</Show>
                        </TabsV2.Content>
                      </Show>

                      <TabsV2.Content
                        value={SESSION_OPEN_FILE_TAB}
                        class="flex flex-col h-full overflow-hidden contain-strict"
                      >
                        <Show when={activeTab() === SESSION_OPEN_FILE_TAB}>
                          <SessionReviewEmptyOpenFileV2 />
                        </Show>
                      </TabsV2.Content>

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
                        {(tab) => <FileTabContentV2 tab={tab} review={props.fileTabReview} />}
                      </Show>
                    </div>
                  </div>
                </TabsV2>
                <Show when={tabsV2.drag.active && tabsV2.drag.draggedTab} keyed>
                  {(tab) => {
                    const path = file.pathFromTab(tab)
                    return (
                      <Portal>
                        <div style={tabsV2.floaterStyle()}>
                          <div data-component="tabs-v2-drag-preview">
                            <Show
                              when={path}
                              fallback={
                                <div class="flex items-center gap-1.5">
                                  <IconV2 name="open-file" size="small" />
                                  <div>{language.t("command.file.open")}</div>
                                </div>
                              }
                            >
                              {(value) => <FileVisual active path={value()} textClass="truncate" />}
                            </Show>
                          </div>
                        </div>
                      </Portal>
                    )
                  }}
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
