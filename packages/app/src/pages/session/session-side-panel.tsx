import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { FileSearchButton } from "@/components/session/file-search-button"
import { useClientEnv } from "@/context/client-env"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePromptDocBridge } from "@/context/prompt-doc-bridge"
import { useSessionPreviewBridge } from "@/context/session-preview-bridge"
import { useSync } from "@/context/sync"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { DiffTabContent } from "@/pages/session/diff-tab"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { SessionPreviewPanel, SessionBrowserChrome, createSessionPreview } from "@/pages/session/session-preview-panel"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionSidePanel(props: {
  reviewPanel: JSX.Element
  activeDiff?: string
  onChangeFileClick: (path: string) => void
  reviewSnap: boolean
  size: Sizing
}) {
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const env = useClientEnv()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const bridge = usePromptDocBridge()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const onContextAdd = createMemo(() => {
    if (bridge.mode() !== "doc") return
    return (path: string, type: "file" | "directory") => {
      bridge.addReference(path, type)
    }
  })

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop() && !env.productionLayout())
  const previewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return `calc(100% - ${layout.session.width()}px)`
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

  const pathFromContentTab = (tab: string) => file.pathFromTab(tab) ?? file.pathFromDiffTab(tab)

  const normalizeTab = (tab: string) => {
    if (tab.startsWith("file://")) return file.tab(tab)
    if (tab.startsWith("diff://")) {
      const path = file.pathFromDiffTab(tab)
      if (path) return file.diffTab(path)
    }
    return tab
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: pathFromContentTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: pathFromContentTab,
    normalizeTab,
    review: reviewTab,
    preview: previewTab,
    hasReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  // 미리보기 우선: 콘텐츠가 미리보기뿐일 때는 탭 스트립을 숨긴다.
  // 파일·컨텍스트 탭이 열리거나 리뷰 변경이 있을 때만 상단 탭 스트립을 노출(시안 OcBrowser showStrip 확장).
  const showTabStrip = createMemo(() => openedTabs().length > 0 || contextOpen() || (reviewTab() && hasReview()))

  // 미리보기 브라우저 chrome 바(시안 SafariChrome) — URL·새로고침 공유.
  const preview = createSessionPreview()
  // 미리보기 헤더의 스크린샷 버튼 ↔ 컴포저(PromptInput)의 캡처 플로우를 공유.
  const previewBridge = useSessionPreviewBridge()
  previewBridge.setBridge(preview.bridge)
  // 주소창 입력: 파일 탭이 활성이면 파일 경로를 읽기 전용 표시, 아니면(미리보기) host 고정 + 경로 편집 가능.
  const browserAddress = createMemo(() => {
    const active = activeFileTab()
    if (active) {
      const path = pathFromContentTab(active)
      if (path) return { host: undefined as string | undefined, path, editablePath: false }
    }
    return { host: preview.host(), path: preview.path(), editablePath: true }
  })

  const fileTreeTab = () => (env.disableChangeFiles() ? "all" : layout.fileTree.tab())

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    if (value === "changes" && env.disableChangeFiles()) return
    layout.fileTree.setTab(value)
  }

  createEffect(() => {
    if (env.disableChangeFiles() && layout.fileTree.tab() === "changes") layout.fileTree.setTab("all")
  })

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const openFileSearch = () => {
    void import("@/components/dialog-select-file").then((x) => {
      dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
    })
  }

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
          const path = pathFromContentTab(tab)
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
        data-component="codle-side-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex flex-col border-l border-border-weaker-base">
          {/* 브라우저 chrome 바 — 시안처럼 상단 전체 폭을 차지(탐색기·미리보기 위). */}
          <SessionBrowserChrome
            host={browserAddress().host}
            path={browserAddress().path}
            editablePath={browserAddress().editablePath}
            onNavigatePath={preview.navigatePath}
            canGoBack={preview.canGoBack()}
            canGoForward={preview.canGoForward()}
            onBack={preview.goBack}
            onForward={preview.goForward}
            url={preview.previewUrl()}
            onReload={preview.reload}
            onHome={() => {
              tabs().setActive("preview")
              preview.reload()
            }}
            onCapture={previewBridge.requestCapture}
            capturing={previewBridge.capturing()}
          />
          <div class="flex-1 min-h-0 flex">
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
                <Tabs value={activeTab()} onChange={openTab}>
                  <Show when={showTabStrip()}>
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
                              <span data-slot="tabs-trigger-badge">{reviewCount()}</span>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={previewTab()}>
                        <Tabs.Trigger value="preview">
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.preview")}</div>
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
                      <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
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
                            onClick={openFileSearch}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipKeybind>
                      </div>
                    </Tabs.List>
                  </div>
                  </Show>

                  <Show when={reviewTab()}>
                    <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "review"}>{props.reviewPanel}</Show>
                    </Tabs.Content>
                  </Show>

                  <Show when={previewTab()}>
                    <Tabs.Content value="preview" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "preview"}>
                        <SessionPreviewPanel src={preview.previewSrc()} bridge={preview.bridge} />
                      </Show>
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
                    {(tab) => (
                      <Switch>
                        <Match when={file.pathFromDiffTab(tab)}>
                          <DiffTabContent tab={tab} />
                        </Match>
                        <Match when={true}>
                          <FileTabContent tab={tab} />
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </Tabs>
                <DragOverlay>
                  <Show when={store.activeDraggable} keyed>
                    {(tab) => {
                      const path = pathFromContentTab(tab)
                      return (
                        <div data-component="tabs-drag-preview">
                          <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
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
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="order-first relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-r border-border-weaker-base": reviewOpen() }}
            >
              {/* 운영 레이아웃은 타이틀바/헤더가 없어 "파일 검색" 버튼이 사라진다.
                  탐색기 상단에 직접 노출해 동일한 DialogSelectFile 모달을 연다. */}
              <Show when={env.productionLayout()}>
                <div class="shrink-0 px-3 pt-3">
                  <FileSearchButton onClick={openFileSearch} />
                </div>
              </Show>
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                {/* Changes/All 탭이 둘 다 의미 있을 때만 pill 헤더 노출. 변경 파일 탭이 꺼져
                    "모든 파일" 하나뿐이면(시안처럼) 헤더를 숨기고 트리만 보인다. */}
                <Show when={!env.disableChangeFiles()}>
                  <Tabs.List>
                    <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                      <span data-slot="tabs-trigger-badge">{reviewCount()}</span>
                      {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                      {language.t("session.files.all")}
                    </Tabs.Trigger>
                  </Tabs.List>
                </Show>
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
                          onFileClick={(node) => props.onChangeFileClick(node.path)}
                          onContextAdd={onContextAdd()}
                          contextLabel={language.t("session.files.addToContext")}
                          contextFolderLabel={language.t("session.files.addFolderToContext")}
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
                    <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                    <Match when={true}>
                      <FileTree
                        path=""
                        class="pt-3"
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                        onContextAdd={onContextAdd()}
                        contextLabel={language.t("session.files.addToContext")}
                        contextFolderLabel={language.t("session.files.addFolderToContext")}
                      />
                    </Match>
                  </Switch>
                </Tabs.Content>
              </Tabs>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="end"
                  size={layout.fileTree.width()}
                  min={200}
                  max={360}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>
          </div>
        </div>
      </aside>
    </Show>
  )
}
