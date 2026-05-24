import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon } from "@opencode-ai/ui/icon"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { FileTreeDragOverlay } from "@/components/file-tree-drag-overlay"
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
import { createOpenSessionFileTab, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { StickyAddButton } from "@/pages/session/review-tab"
import { setSessionHandoff } from "@/pages/session/handoff"

export function SessionSidePanel(props: {
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
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

  let fileTreePanelRef: HTMLDivElement | undefined

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return layout.session.opened() ? `calc(100% - ${layout.session.width()}px)` : "100%"
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

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

  const reviewEmptyKey = createMemo(() => {
    if (sync.project && !sync.project.vcs) return "session.review.noVcs"
    if (sync.data.config.snapshot === false) return "session.review.noSnapshot"
    return "session.review.noChanges"
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
    if (value !== "changes" && value !== "all" && value !== "dashboards" && value !== "workflows") return
    layout.fileTree.setTab(value as any)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  // Drag-and-drop state for file tree panel
  // isDraggingOverFileTree: shows/hides the drop zone overlay
  // dragCounter: tracks nested dragenter/dragleave events to handle child elements
  //
  // WHY WE NEED A COUNTER:
  // When dragging over a parent container with child elements (like the file tree),
  // the browser fires dragenter for the parent, then dragenter for each child
  // as you move the cursor, followed by dragleave when leaving each child.
  // Without a counter, leaving a child would immediately hide the overlay,
  // even though you're still dragging over the parent. The counter increments
  // on each dragenter and decrements on each dragleave. When it reaches 0,
  // we know we've actually left the entire file tree panel.
  const [isDraggingOverFileTree, setIsDraggingOverFileTree] = createSignal(false)
  const [dragCounter, setDragCounter] = createSignal(0)

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

  // File tree drag-drop using CAPTURE PHASE to intercept events before they reach the chat
  //
  // PROBLEM: The chat input has document-level drag handlers (bubble phase) that show a
  // "drop files here" overlay. When dragging files over the file tree, we want OUR overlay
  // to show (for uploading to the project) not the chat overlay (for attaching to message).
  //
  // SOLUTION: Use capture phase (addEventListener(..., true)) which fires BEFORE bubble phase.
  // When user drags over file tree:
  //   1. Capture phase: Our handler fires, shows file tree overlay, calls stopPropagation()
  //   2. Bubble phase: Chat's document handler never fires because propagation stopped
  //
  // This ensures the file tree always "wins" when dragging over it, preventing the chat
  // from intercepting the drag and showing its overlay.
  createEffect(() => {
    if (!fileTreePanelRef || !fileOpen()) return

    const handleDragEnter = (e: globalThis.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const count = dragCounter() + 1
      setDragCounter(count)
      if (count === 1 && e.dataTransfer?.types.includes("Files")) {
        setIsDraggingOverFileTree(true)
      }
    }

    const handleDragLeave = (e: globalThis.DragEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement
      const isMovingToChild = relatedTarget?.closest?.("#file-tree-panel")

      e.preventDefault()
      e.stopPropagation()

      // If moving to a child element, don't decrement counter
      if (isMovingToChild) return

      const count = dragCounter() - 1
      setDragCounter(Math.max(0, count))

      if (count <= 0) {
        setIsDraggingOverFileTree(false)
      }
    }

    const handleDragOver = (e: globalThis.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy"
      }
    }

    const handleDrop = async (e: globalThis.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDraggingOverFileTree(false)
      setDragCounter(0)

      const dt = e.dataTransfer
      if (!dt || dt.files.length === 0) return

      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files.item(i)
        if (!f) continue
        const arrayBuffer = await f.arrayBuffer()
        const content = new Uint8Array(arrayBuffer)
        await file.upload(f.name, content)
      }
    }

    // Capture phase fires before bubble phase
    fileTreePanelRef.addEventListener("dragenter", handleDragEnter, true)
    fileTreePanelRef.addEventListener("dragleave", handleDragLeave, true)
    fileTreePanelRef.addEventListener("dragover", handleDragOver, true)
    fileTreePanelRef.addEventListener("drop", handleDrop, true)

    // Safety: if drag leaves window or ends, reset state
    const handleWindowDragLeave = () => {
      setIsDraggingOverFileTree(false)
      setDragCounter(0)
    }
    window.addEventListener("dragleave", handleWindowDragLeave)
    window.addEventListener("dragend", handleWindowDragLeave)

    onCleanup(() => {
      fileTreePanelRef?.removeEventListener("dragenter", handleDragEnter, true)
      fileTreePanelRef?.removeEventListener("dragleave", handleDragLeave, true)
      fileTreePanelRef?.removeEventListener("dragover", handleDragOver, true)
      fileTreePanelRef?.removeEventListener("drop", handleDrop, true)
      window.removeEventListener("dragleave", handleWindowDragLeave)
      window.removeEventListener("dragend", handleWindowDragLeave)
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

  return (
    <Show when={isDesktop()}>
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
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex border-l border-border-weaker-base">
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
                <Tabs value={activeTab()} onChange={openTab} class="flex h-full min-h-0 flex-col">
                  <div class="sticky top-0 shrink-0 flex border-b border-border-weak-base">
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
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
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
                            </TooltipKeybind>
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
                            onClick={() =>
                              dialog.show(() => <DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                            }
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
                        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
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
          </div>

          <div
            id="file-tree-panel"
            ref={fileTreePanelRef}
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <FileTreeDragOverlay
              active={isDraggingOverFileTree()}
              label={language.t("filetree.dropHere") || "Drop files here"}
            />
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": reviewOpen() }}
            >
              <Tabs
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
                style={{
                  "--tabs-compact-pill-height": "40px",
                  "--tabs-bar-height": "48px",
                  "--tabs-compact-pill-padding-x": "4px",
                }}
              >
                <div class="border-b border-border-weak-base">
                  <Tabs.List class="flex w-full h-[48px]">
                    <Tabs.Trigger value="all" class="flex-1" classes={{ button: "group w-full h-full" }}>
                      <div class="flex flex-col items-center justify-center gap-1 text-text-weak group-hover:text-text-base group-data-[selected]:text-text-strong group-data-[selected]:font-semibold transition-colors h-full w-full">
                        <Icon name="code-lines" class="w-[16px] h-[16px] text-icon-weak group-hover:text-icon-interactive-base group-data-[selected]:text-icon-interactive-base transition-colors" />
                        <span class="text-[10px] leading-none">Files</span>
                      </div>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="dashboards" class="flex-1" classes={{ button: "group w-full h-full" }}>
                      <div class="flex flex-col items-center justify-center gap-1 text-text-weak group-hover:text-text-base group-data-[selected]:text-text-strong group-data-[selected]:font-semibold transition-colors h-full w-full">
                        <Icon name="layout-bottom" class="w-[16px] h-[16px] text-icon-weak group-hover:text-icon-agent-plan-base group-data-[selected]:text-icon-agent-plan-base transition-colors" />
                        <span class="text-[10px] leading-none">Dashboards</span>
                      </div>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="workflows" class="flex-1" classes={{ button: "group w-full h-full" }}>
                      <div class="flex flex-col items-center justify-center gap-1 text-text-weak group-hover:text-text-base group-data-[selected]:text-text-strong group-data-[selected]:font-semibold transition-colors h-full w-full">
                        <Icon name="branch" class="w-[16px] h-[16px] text-icon-weak group-hover:text-icon-agent-docs-base group-data-[selected]:text-icon-agent-docs-base transition-colors" />
                        <span class="text-[10px] leading-none">Workflows</span>
                      </div>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "group w-full h-full" }}>
                      <div class="flex flex-col items-center justify-center gap-1 text-text-weak group-hover:text-text-base group-data-[selected]:text-text-strong group-data-[selected]:font-semibold transition-colors h-full w-full">
                        <div class="relative">
                          <Icon name="circle-check" class="w-[16px] h-[16px] text-icon-weak group-hover:text-icon-success-base group-data-[selected]:text-icon-success-base transition-colors" />
                          <Show when={hasReview()}>
                            <div class="absolute -top-1.5 -right-2.5 flex h-[12px] min-w-[12px] items-center justify-center rounded-full bg-border-stronger-base px-1 text-[8px] font-medium text-text-weak tabular-nums">
                              {reviewCount()}
                            </div>
                          </Show>
                        </div>
                        <span class="text-[10px] leading-none flex items-center gap-1">
                          Audit
                        </span>
                      </div>
                    </Tabs.Trigger>
                  </Tabs.List>
                </div>
                <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
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
                          class="pt-3"
                          allowed={diffFiles()}
                          kinds={kinds()}
                          draggable={false}
                          active={props.activeDiff}
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>
                      {empty(
                        language.t(sync.project && !sync.project.vcs ? "session.review.noChanges" : reviewEmptyKey()),
                      )}
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={nofiles()}>
                      <FileTree
                        path=""
                        class="pt-3"
                        droppable={true}
                        emptyActions={true}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                        onUpload={async (files) => {
                          for (const f of files) {
                            const arrayBuffer = await f.arrayBuffer()
                            const content = new Uint8Array(arrayBuffer)
                            await file.upload(f.name, content)
                          }
                        }}
                      />
                    </Match>
                    <Match when={true}>
                      <FileTree
                        path=""
                        class="pt-3"
                        modified={diffFiles()}
                        kinds={kinds()}
                        droppable={true}
                        emptyActions={true}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                        onUpload={async (files) => {
                          for (const f of files) {
                            const arrayBuffer = await f.arrayBuffer()
                            const content = new Uint8Array(arrayBuffer)
                            await file.upload(f.name, content)
                          }
                        }}
                      />
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="dashboards" class="bg-background-stronger px-3 py-0 flex-1 flex flex-col items-center justify-center text-text-weak">
                  <div class="text-12-regular text-center">Dashboards coming soon</div>
                </Tabs.Content>
                <Tabs.Content value="workflows" class="bg-background-stronger px-3 py-0 flex-1 flex flex-col items-center justify-center text-text-weak">
                  <div class="text-12-regular text-center">Workflows coming soon</div>
                </Tabs.Content>
              </Tabs>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
                  max={480}
                  collapseThreshold={160}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                  onCollapse={layout.fileTree.close}
                />
              </div>
            </Show>
          </div>
        </div>
      </aside>
    </Show>
  )
}
