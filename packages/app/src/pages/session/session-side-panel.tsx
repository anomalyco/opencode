import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, getTabReorderIndex } from "@/pages/session/helpers"
import { StickyAddButton } from "@/pages/session/review-tab"
import { setSessionHandoff } from "@/pages/session/handoff"

export function SessionSidePanel(props: {
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
}) {
  const params = useParams()
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const open = createMemo(() => isDesktop() && (view().reviewPanel.opened() || layout.fileTree.opened()))
  const reviewTab = createMemo(() => isDesktop())

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
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

  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const openedTabs = createMemo(() =>
    tabs()
      .all()
      .filter((tab) => tab !== "context" && tab !== "review"),
  )

  const activeTab = createMemo(() => {
    const active = tabs().active()
    if (active === "context") return "context"
    if (active === "review" && reviewTab()) return "review"
    if (active && file.pathFromTab(active)) return normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (reviewTab() && hasReview()) return "review"
    return "empty"
  })

  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    fileTreeScrolled: false,
  })

  let changesEl: HTMLDivElement | undefined
  let allEl: HTMLDivElement | undefined

  const syncFileTreeScrolled = (el?: HTMLDivElement) => {
    const next = (el?.scrollTop ?? 0) > 0
    setStore("fileTreeScrolled", (current) => (current === next ? current : next))
  }

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
    if (!layout.fileTree.opened()) return
    syncFileTreeScrolled(fileTreeTab() === "changes" ? changesEl : allEl)
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

  return (
    <Show when={open()}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        class="relative min-w-0 h-full border-l border-border-weak-base flex"
        classList={{
          "flex-1": reviewOpen(),
          "shrink-0": !reviewOpen(),
        }}
        style={{ width: reviewOpen() ? undefined : `${layout.fileTree.width()}px` }}
      >
        <Show when={reviewOpen()}>
          <div class="flex-1 min-w-0 h-full">
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <Tabs value={activeTab()} onChange={openTab}>
                <div class="sticky top-0 shrink-0 flex">
                  <Tabs.List
                    ref={(el: HTMLDivElement) => {
                      const stop = createFileTabListSync({ el, contextOpen })
                      onCleanup(stop)
                    }}
                  >
                    <Show when={reviewTab()}>
                      <Tabs.Trigger value="review">
                        <div class="flex items-center gap-1.5">
                          <div>{language.t("session.tab.review")}</div>
                          <Show when={hasReview()}>
                            <div>{reviewCount()}</div>
                          </Show>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <Show when={contextOpen()}>
                      <Tabs.Trigger
                        value="context"
                        closeButton={
                          <Tooltip value={language.t("common.closeTab")} placement="bottom" gutter={10}>
                            <IconButton
                              icon="close-small"
                              variant="ghost"
                              class="h-5 w-5"
                              onClick={() => tabs().close("context")}
                              aria-label={language.t("common.closeTab")}
                            />
                          </Tooltip>
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
                    <SortableProvider ids={openedTabs()}>
                      <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                    </SortableProvider>
                    <StickyAddButton>
                      <TooltipKeybind
                        title={language.t("command.file.open")}
                        keybind={command.keybind("file.open")}
                        class="flex items-center"
                      >
                        <IconButton
                          icon="plus-small"
                          variant="ghost"
                          iconSize="large"
                          class="!rounded-md"
                          onClick={() => dialog.show(() => <DialogSelectFile mode="files" onOpenFile={showAllFiles} />)}
                          aria-label={language.t("command.file.open")}
                        />
                      </TooltipKeybind>
                    </StickyAddButton>
                  </Tabs.List>
                </div>

                <Show when={reviewTab()}>
                  <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "review"}>{props.reviewPanel()}</Show>
                  </Tabs.Content>
                </Show>

                <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                  <Show when={activeTab() === "empty"}>
                    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                      <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                        <Mark class="w-14 opacity-10" />
                        <div class="text-14-regular text-text-weak max-w-56">
                          {language.t("session.files.selectToOpen")}
                        </div>
                      </div>
                    </div>
                  </Show>
                </Tabs.Content>

                <Show when={contextOpen()}>
                  <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "context"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <SessionContextTab />
                      </div>
                    </Show>
                  </Tabs.Content>
                </Show>

                <Show when={activeFileTab()} keyed>
                  {(tab) => <FileTabContent tab={tab} />}
                </Show>
              </Tabs>
              <DragOverlay>
                <Show when={store.activeDraggable} keyed>
                  {(tab) => {
                    const path = createMemo(() => file.pathFromTab(tab))
                    return (
                      <div data-component="tabs-drag-preview">
                        <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                      </div>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </div>
        </Show>

        <Show when={layout.fileTree.opened()}>
          <div id="file-tree-panel" class="relative shrink-0 h-full" style={{ width: `${layout.fileTree.width()}px` }}>
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": reviewOpen() }}
            >
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List data-scrolled={store.fileTreeScrolled ? "" : undefined}>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {reviewCount()}{" "}
                    {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content
                  value="changes"
                  ref={(el: HTMLDivElement) => (changesEl = el)}
                  onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) => syncFileTreeScrolled(e.currentTarget)}
                  class="bg-background-stronger px-3 py-0"
                >
                  <Switch>
                    <Match when={hasReview()}>
                      <Show
                        when={diffsReady()}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {language.t("common.loading")}
                            {language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <FileTree
                          path=""
                          allowed={diffFiles()}
                          kinds={kinds()}
                          draggable={false}
                          active={props.activeDiff}
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>
                      <div class="mt-8 text-center text-12-regular text-text-weak">
                        {language.t("session.review.noChanges")}
                      </div>
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content
                  value="all"
                  ref={(el: HTMLDivElement) => (allEl = el)}
                  onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) => syncFileTreeScrolled(e.currentTarget)}
                  class="bg-background-stronger px-3 py-0"
                >
                  <FileTree
                    path=""
                    modified={diffFiles()}
                    kinds={kinds()}
                    onFileClick={(node) => openTab(file.tab(node.path))}
                  />
                </Tabs.Content>
              </Tabs>
            </div>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={layout.fileTree.width()}
              min={200}
              max={480}
              collapseThreshold={160}
              onResize={layout.fileTree.resize}
              onCollapse={layout.fileTree.close}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
