import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { DragDropProvider as DndKitProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"

import FileTree from "@/components/file-tree"
import { normalizeFileTreeV2Path } from "@/components/file-tree-v2-model"
import { SessionContextUsage } from "@/components/session-context-usage"

const reviewTabID = "session-side-panel-review-tab"
const reviewTabPanelID = "session-side-panel-review-tabpanel"
const fileBrowserTabPanelID = "session-side-panel-file-browser-tabpanel"
import { SessionContextTab, SortableTabV2 } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useWorkspaceLocation } from "@/context/location"
import { useSettings } from "@/context/settings"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import {
  SESSION_OPEN_FILE_TAB,
  createOpenSessionFileTab,
  createSessionTabs,
  shouldShowFileTree,
  type Sizing,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionFileBrowserTab, type SessionFileBrowserState } from "@/pages/session/v2/session-file-browser-tab"

type ReviewDiff = FileDiffInfo
type RenderDiff = FileDiffInfo
const FILE_TREE_WIDTH_MIN = 240

function renderDiff(value: ReviewDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: boolean
  diffs: ReviewDiff[]
  diffsReady: boolean
  hasReview: boolean
  reviewHasFocusableContent: boolean
  reviewCount: number
  reviewPanel: () => JSX.Element
  reviewSidebarToggle: (disabled: boolean) => JSX.Element
  fileBrowserState: SessionFileBrowserState
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  stacked?: boolean
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sdk = useWorkspaceLocation()
  const { sessionKey, tabs, view, params } = useSessionLayout()
  const projectDirectory = createMemo(() => sdk().directory)

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const shown = settings.visibility.fileTree

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: shown(),
        opened: layout.fileTree.opened(),
      }),
  )
  const open = createMemo(() => reviewOpen() || fileOpen())
  const fileTreeWidth = createMemo(() => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width()))
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${fileTreeWidth()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  const diffs = createMemo(() => props.diffs.filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalizeFileTreeV2Path(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
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
    hasReview: () => props.canReview,
    fileBrowser: () => true,
  })
  const contextOpen = tabState.contextOpen
  const openFileOpen = tabState.openFileOpen
  const panelTabs = tabState.panelTabs
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  let fileFilter: HTMLInputElement | undefined
  let tabList: HTMLDivElement | undefined
  const temporaryTab = tabs().preview
  const previewTab = (value: string) => {
    const next = normalizeTab(value)
    tabs().previewTab(next)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    queueMicrotask(() => tabs().setActive(next))
  }
  const openFileBrowser = () => {
    previewTab(SESSION_OPEN_FILE_TAB)
    queueMicrotask(() => fileFilter?.focus())
  }
  const activateTab = (value: string) => {
    const next = normalizeTab(value)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    tabs().setActive(next)
  }
  const browserTab = createMemo(() => {
    const active = activeTab()
    if (active === SESSION_OPEN_FILE_TAB) return SESSION_OPEN_FILE_TAB
    if (active && file.pathFromTab(active)) return active
    return activeFileTab()
  })
  // Keep the file-browser shell mounted while any file tab exists. Kobalte briefly
  // selects Review while the tab For replaces a preview trigger, which would
  // otherwise dispose the sidebar and reset scroll.
  const fileBrowserMounted = createMemo(() => {
    return openedTabs().length > 0 || openFileOpen() || !!browserTab()
  })
  const fileBrowserVisible = createMemo(() => {
    const active = activeTab()
    return active !== "review" && active !== "context" && active !== "empty"
  })
  const openFileKeybind = createMemo(() => command.keybindParts("file.open"))
  const closeTabKeybind = createMemo(() => command.keybindParts("tab.close"))
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

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
        classList={{
          "h-full shrink-0": !props.stacked,
          "h-full min-h-0": props.stacked,
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
          "flex-1": reviewOpen(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={open()}>
          <div class="size-full flex">
            <Show when={reviewOpen()}>
              <div class="relative min-w-0 h-full flex-1 overflow-hidden bg-v2-background-bg-base">
                <div class="size-full min-w-0 h-full bg-v2-background-bg-base">
                  <DndKitProvider
                    sensors={[
                      PointerSensor.configure({
                        activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                        preventActivation: (event) =>
                          event.target instanceof Element &&
                          (!!event.target.closest('[data-slot="tabs-trigger-close-button"]') ||
                            !!event.target.closest(".session-review-v2-open-in-app-slot")),
                      }),
                    ]}
                    modifiers={[
                      RestrictToHorizontalAxis,
                      RestrictToElement.configure({ element: () => tabList ?? null }),
                    ]}
                    plugins={(defaults) => [
                      ...defaults.filter((plugin) => plugin !== Accessibility),
                      AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
                      Feedback.configure({ dropAnimation: null }),
                    ]}
                    onDragEnd={(event) => {
                      const source = event.operation.source
                      if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                      tabs().move(source.id.toString(), source.index)
                    }}
                  >
                    <Tabs value={activeTab()} onChange={activateTab}>
                      <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
                        <Tabs.List
                          ref={(el: HTMLDivElement) => {
                            tabList = el
                            const stop = createFileTabListSync({ el, contextOpen })
                            onCleanup(stop)
                          }}
                        >
                          <div class="session-review-v2-sidebar-toggle-slot h-full shrink-0 sticky left-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                            {props.reviewSidebarToggle(activeTab() === SESSION_OPEN_FILE_TAB)}
                          </div>
                          <Show when={reviewTab() && props.canReview}>
                            <Tabs.Trigger
                              value="review"
                              id={reviewTabID}
                              aria-controls={activeTab() === "review" ? reviewTabPanelID : undefined}
                            >
                              {props.hasReview
                                ? language.t("session.review.filesChanged", { count: props.reviewCount })
                                : language.t("session.tab.review")}
                            </Tabs.Trigger>
                          </Show>
                          <Show when={contextOpen()}>
                            <Tabs.Trigger
                              value="context"
                              closeButton={
                                <TooltipV2
                                  value={
                                    <>
                                      {language.t("common.closeTab")}
                                      <Show when={closeTabKeybind().length > 0}>
                                        <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                                      </Show>
                                    </>
                                  }
                                  placement="bottom"
                                  gutter={10}
                                >
                                  <IconButton
                                    icon="close-small"
                                    variant="ghost"
                                    class="h-5 w-5"
                                    onClick={() => tabs().close("context")}
                                    aria-label={language.t("common.closeTab")}
                                  />
                                </TooltipV2>
                              }
                              hideCloseButton
                              onMiddleClick={() => tabs().close("context")}
                            >
                              <div class="flex items-center gap-2">
                                <SessionContextUsage variant="indicator" />
                                <div>{language.t("session.tab.context")}</div>
                              </div>
                            </Tabs.Trigger>
                          </Show>
                          <For each={panelTabs()}>
                            {(tab) => (
                              <Show
                                when={tab === SESSION_OPEN_FILE_TAB}
                                fallback={
                                  <SortableTabV2
                                    tab={tab}
                                    index={tabs().all().indexOf(tab)}
                                    temporary={temporaryTab() === tab}
                                    onTabClose={tabs().close}
                                    onTabDoubleClick={temporaryTab() === tab ? openTab : undefined}
                                  />
                                }
                              >
                                <Tabs.Trigger
                                  value={SESSION_OPEN_FILE_TAB}
                                  closeButton={
                                    <TooltipV2
                                      value={
                                        <>
                                          {language.t("common.closeTab")}
                                          <Show when={closeTabKeybind().length > 0}>
                                            <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                                          </Show>
                                        </>
                                      }
                                      placement="bottom"
                                      gutter={10}
                                    >
                                      <IconButton
                                        icon="close-small"
                                        variant="ghost"
                                        class="h-5 w-5"
                                        onClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                        aria-label={language.t("common.closeTab")}
                                      />
                                    </TooltipV2>
                                  }
                                  hideCloseButton
                                  onMiddleClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                >
                                  <div class="flex items-center gap-1.5 italic">
                                    <Icon name="open-file" size="small" />
                                    <span>{language.t("command.file.open")}</span>
                                  </div>
                                </Tabs.Trigger>
                              </Show>
                            )}
                          </For>
                          <div class="h-full shrink-0 sticky right-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                            <TooltipV2
                              value={
                                <>
                                  {language.t("command.file.open")}
                                  <Show when={openFileKeybind().length > 0}>
                                    <KeybindV2 keys={openFileKeybind()} variant="neutral" />
                                  </Show>
                                </>
                              }
                              placement="bottom"
                              class="flex items-center"
                            >
                              <IconButtonV2
                                icon={<Icon name="plus-small" />}
                                variant="ghost-muted"
                                size="large"
                                onClick={() => openFileBrowser()}
                                aria-label={language.t("command.file.open")}
                              />
                            </TooltipV2>
                          </div>
                        </Tabs.List>
                        <div
                          class="session-review-v2-open-in-app-slot shrink-0 flex items-center pr-3"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <OpenInAppV2 directory={projectDirectory} />
                        </div>
                      </div>

                      <Show when={reviewTab() && props.canReview && activeTab() === "review"}>
                        <div
                          id={reviewTabPanelID}
                          role="tabpanel"
                          aria-labelledby={reviewTabID}
                          tabIndex={props.reviewHasFocusableContent ? undefined : 0}
                          data-slot="tabs-content"
                          class="flex flex-col h-full overflow-hidden contain-strict"
                        >
                          {props.reviewPanel()}
                        </div>
                      </Show>

                      <Show when={activeTab() === "empty"}>
                        <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                              <Mark class="w-14 opacity-10" />
                              <div class="text-14-regular text-text-weak max-w-56">
                                {language.t("session.files.selectToOpen")}
                              </div>
                            </div>
                          </div>
                        </Tabs.Content>
                      </Show>

                      <Show when={activeTab() === "context"}>
                        <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <SessionContextTab />
                          </div>
                        </Tabs.Content>
                      </Show>

                      <Show when={fileBrowserMounted()}>
                        <div
                          id={fileBrowserTabPanelID}
                          role="tabpanel"
                          data-slot="tabs-content"
                          class="h-full min-h-0 overflow-hidden"
                          classList={{ hidden: !fileBrowserVisible() }}
                          inert={!fileBrowserVisible() || undefined}
                        >
                          <SessionFileBrowserTab
                            tab={browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB}
                            placeholder={
                              (browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB) === SESSION_OPEN_FILE_TAB
                            }
                            active={file.pathFromTab(browserTab() ?? activeFileTab() ?? "")}
                            kinds={kinds()}
                            state={props.fileBrowserState}
                            onSelect={(path) => previewTab(file.tab(path))}
                            onSelectPermanent={(path) => openTab(file.tab(path))}
                            filterRef={(element) => (fileFilter = element)}
                          />
                        </div>
                      </Show>
                    </Tabs>
                  </DndKitProvider>
                </div>
              </div>
            </Show>

            <Show when={fileOpen()}>
              <div
                id="file-tree-panel"
                class="relative min-w-0 h-full shrink-0 overflow-hidden"
                classList={{
                  "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                }}
                style={{ width: treeWidth() }}
              >
                <div
                  class="h-full flex flex-col overflow-hidden group/filetree"
                  classList={{ "border-l border-border-weaker-base": reviewOpen() }}
                >
                  <Tabs
                    variant="pill"
                    value={fileTreeTab()}
                    onChange={setFileTreeTabValue}
                    class="h-full"
                    data-scope="filetree"
                  >
                    <Tabs.List>
                      <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                        {language.t("session.review.filesChanged", { count: props.reviewCount })}
                      </Tabs.Trigger>
                      <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                        {language.t("session.files.all")}
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Show when={fileTreeTab() === "changes"}>
                      <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                        <Switch>
                          <Match when={props.hasReview || !props.diffsReady}>
                            <Show
                              when={props.diffsReady}
                              fallback={
                                <div class="px-2 py-2 text-12-regular text-text-weak">
                                  {language.t("common.loading")}
                                  {language.t("common.loading.ellipsis")}
                                </div>
                              }
                            >
                              <FileTree
                                path=""
                                class="pt-3"
                                allowed={diffFiles()}
                                kinds={kinds()}
                                draggable={false}
                                active={props.activeDiff}
                                onFileClick={(node) => props.focusReviewDiff(node.path)}
                              />
                            </Show>
                          </Match>
                        </Switch>
                      </Tabs.Content>
                    </Show>
                    <Show when={fileTreeTab() === "all"}>
                      <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                        <Switch>
                          <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                          <Match when={true}>
                            <FileTree
                              path=""
                              class="pt-3"
                              modified={diffFiles()}
                              kinds={kinds()}
                              onFileClick={(node) => openTab(file.tab(node.path))}
                            />
                          </Match>
                        </Switch>
                      </Tabs.Content>
                    </Show>
                  </Tabs>
                </div>
                <Show when={fileOpen()}>
                  <div onPointerDown={() => props.size.start()}>
                    <ResizeHandle
                      direction="horizontal"
                      edge="start"
                      size={fileTreeWidth()}
                      min={FILE_TREE_WIDTH_MIN}
                      max={480}
                      onResize={(width) => {
                        props.size.touch()
                        layout.fileTree.resize(width)
                      }}
                    />
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
