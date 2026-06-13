import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@cedric/ui/resize-handle"
import { Tabs } from "@cedric/ui/tabs"
import type { SnapshotFileDiff, VcsFileDiff } from "@cedric/sdk/v2"
import type { Event } from "@cedric/sdk/v2/client"
import { useDialog } from "@cedric/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { WorkspaceTabBar } from "@/components/workspace-tab-bar"
import { NewTabPalette } from "@/components/new-tab-palette"
import {
  BrowserTab,
  DEFAULT_BROWSER_URL,
  browserAnnotationsText,
  browserTabTitle,
  normalizeBrowserAnnotations,
  normalizeBrowserUrl,
  type BrowserAnnotation,
} from "@/components/tabs/browser-tab"
import { FileTab } from "@/components/tabs/file-tab"
import { TerminalTab } from "@/components/tabs/terminal-tab"
import { ChatTab } from "@/components/tabs/chat-tab"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { useTerminal } from "@/context/terminal"
import { usePrompt, type Prompt } from "@/context/prompt"
import type { Sizing } from "@/pages/session/helpers"
import { shouldShowSessionSidePanel } from "@/pages/session/session-side-panel-visibility"
import { useSessionLayout } from "@/pages/session/session-layout"
import { openWorkspaceAction } from "@/pages/session/workspace-actions"
import { createWorkspaceTabs, type WorkspaceTab } from "@/context/workspace-tabs"
import { Persist } from "@/utils/persist"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

export const WORKSPACE_PANEL_WIDTH = 600

function renderDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
}

function tabStateString(tab: { state: Record<string, unknown> }, key: string) {
  const value = tab.state[key]
  return typeof value === "string" ? value : undefined
}

function tabStateBrowserAnnotations(tab: { state: Record<string, unknown> }, key = "annotations") {
  return normalizeBrowserAnnotations(tab.state[key])
}

function isWorkspaceActionEvent(event: Event): event is Extract<Event, { type: "workspace.action.requested" }> {
  return event.type === "workspace.action.requested"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  onWorkspacePanelWidthChange?: (width: number) => void
}) {
  const layout = useLayout()
  const platform = usePlatform()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const terminal = useTerminal()
  const prompt = usePrompt()
  const { view, params } = useSessionLayout()
  const workspace = createWorkspaceTabs({
    persist: Persist.serverWorkspace(serverSDK.scope, sdk.directory, "workspace-tabs", ["workspace-tabs.v1"]),
  })
  const desktopWindow = window as Window & {
    api?: {
      onActivateBrowserTab?: (cb: (payload: { url?: string }) => void) => () => void
    }
  }

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const desktopV2 = () => platform.platform === "desktop" && settings.general.newLayoutDesigns()
  const shown = createMemo(() => (desktopV2() ? settings.general.showFileTree() : true))

  const reviewOpen = createMemo(() => isDesktop() && Boolean(params.id) && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && shown() && layout.fileTree.opened())
  const hasWorkspaceTabs = createMemo(() => workspace.state.tabs.length > 0)
  const open = createMemo(() => reviewOpen() || fileOpen() || hasWorkspaceTabs())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    if (hasWorkspaceTabs()) return `${WORKSPACE_PANEL_WIDTH}px`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  createEffect(() => {
    props.onWorkspacePanelWidthChange?.(hasWorkspaceTabs() && !reviewOpen() ? WORKSPACE_PANEL_WIDTH : 0)
  })

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
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

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  // Initialize workspace with review tab
  createEffect(() => {
    if (!workspace.ready()) return
    if (props.canReview() && workspace.state.tabs.length === 0) {
      workspace.openTab("review", {
        title: "Review",
        isPinned: true,
        activate: true,
      })
    }
  })

  const [showNewTabPalette, setShowNewTabPalette] = createSignal(false)

  const handleNewTab = () => {
    setShowNewTabPalette(!showNewTabPalette())
  }

  const createBrowserTab = (url?: string) => {
    const target = normalizeBrowserUrl(url ?? DEFAULT_BROWSER_URL) || DEFAULT_BROWSER_URL
    return workspace.openTab("browser", {
      title: browserTabTitle(target),
      state: { url: target },
    })
  }

  const focusBrowserTab = (url?: string) => {
    const existing = workspace.allTabs().find((tab) => tab.isActive && tab.type === "browser") ?? workspace.getTabsByType("browser")[0]
    if (existing && !url) {
      workspace.activateTab(existing.id)
      return existing.id
    }

    const target = normalizeBrowserUrl(url ?? DEFAULT_BROWSER_URL) || DEFAULT_BROWSER_URL
    if (!existing) return createBrowserTab(target)

    workspace.activateTab(existing.id)
    workspace.updateTab(existing.id, { title: browserTabTitle(target) })
    workspace.updateTabState(existing.id, { url: target })
    return existing.id
  }

  const releaseBrowserActivation = desktopWindow.api?.onActivateBrowserTab?.((payload) => {
    focusBrowserTab(payload.url)
  })
  const releaseWorkspaceActions = serverSDK.event.listen((event) => {
    if (event.name !== sdk.directory) return
    if (!isWorkspaceActionEvent(event.details)) return
    if (event.details.properties.sessionID !== params.id) return
    openWorkspaceAction(workspace, event.details.properties.action)
  })

  onCleanup(() => {
    releaseBrowserActivation?.()
    releaseWorkspaceActions()
  })

  const handleOpenBrowser = (url?: string) => {
    createBrowserTab(url)
    setShowNewTabPalette(false)
  }

  const handleOpenFile = () => {
    void import("@/components/dialog-select-file").then((x) => {
      void dialog.show(() => (
        <x.DialogSelectFile
          mode="files"
          onOpenFile={(path) => {
            workspace.openTab("file", {
              title: path.split("/").pop() || path,
              state: { path },
            })
            setShowNewTabPalette(false)
          }}
        />
      ))
    })
  }

  const handleOpenTerminal = () => {
    workspace.openTab("terminal", { title: "Terminal" })
    setShowNewTabPalette(false)
  }

  const handleOpenChat = () => {
    workspace.openTab("chat", { title: "Chat" })
    setShowNewTabPalette(false)
  }

  const promptLength = (parts: Prompt) => parts.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)

  const focusMainPrompt = () => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-component="prompt-input"][contenteditable="true"]')?.focus()
    })
  }

  const appendTextToMainPrompt = (text: string) => {
    const current = prompt.current()
    const length = promptLength(current)
    const content = `${length ? "\n\n" : ""}${text}`
    const part = { type: "text" as const, content, start: length, end: length + content.length }

    prompt.set(
      current.length === 1 && current[0]?.type === "text" && !current[0].content ? [part] : [...current, part],
      length + content.length,
    )
    focusMainPrompt()
  }

  const handleSendBrowserToChat = (context: { title?: string; url: string; annotations?: BrowserAnnotation[] }) => {
    workspace.openTab("chat", {
      title: "Chat",
      state: {
        contextUrl: context.url,
        contextTitle: context.title,
        contextAnnotations: context.annotations ?? [],
      },
    })
  }

  const handleSendBrowserToMainChat = (context: { title?: string; url: string; annotations?: BrowserAnnotation[] }) => {
    if (!context.url) return
    const title = context.title?.trim()
    const annotations = browserAnnotationsText(context.annotations ?? [])
    appendTextToMainPrompt(
      [
        "Use this browser page as context:",
        ...(title ? [`Title: ${title}`] : []),
        `URL: ${context.url}`,
        ...(annotations ? [annotations] : []),
      ].join("\n"),
    )
  }

  const handleSendFileToChat = (path: string) => {
    if (!path) return
    workspace.openTab("chat", {
      title: "Chat",
      state: {
        contextFilePath: path,
      },
    })
  }

  const handleSendFileToMainChat = (path: string) => {
    if (!path) return
    prompt.context.add({ type: "file", path })
    focusMainPrompt()
  }

  const terminalPtyId = (tab: WorkspaceTab) => (tab.type === "terminal" ? tabStateString(tab, "ptyId") : undefined)

  const closeTerminalPty = (tab: WorkspaceTab) => {
    const ptyId = terminalPtyId(tab)
    if (!ptyId) return
    if (workspace.allTabs().some((item) => item.id !== tab.id && terminalPtyId(item) === ptyId)) return
    void terminal.close(ptyId)
  }

  const closeWorkspaceTab = (id: string) => {
    const tab = workspace.getTab(id)
    if (!tab) return
    workspace.closeTab(id)
    if (!tab.isPinned) closeTerminalPty(tab)
  }

  const closeOtherWorkspaceTabs = (id: string) => {
    const closing = workspace.allTabs().filter((tab) => tab.id !== id && !tab.isPinned)
    workspace.closeOtherTabs(id)
    closing.forEach(closeTerminalPty)
  }

  const closeAllWorkspaceTabs = () => {
    const closing = workspace.allTabs().filter((tab) => !tab.isPinned)
    workspace.closeAllTabs()
    closing.forEach(closeTerminalPty)
  }

  const handleWorkspaceKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !workspace.ready() || !workspace.allTabs().length) return
    if (!event.metaKey && !event.ctrlKey) return

    const key = event.key.toLowerCase()
    if (key === "w" && !event.shiftKey) {
      event.preventDefault()
      const active = workspace.activeTab()
      if (active) closeWorkspaceTab(active.id)
      return
    }
    if (key === "t") {
      event.preventDefault()
      if (event.shiftKey) {
        workspace.reopenClosedTab()
        return
      }
      setShowNewTabPalette(true)
      return
    }
    if (/^[1-9]$/.test(key)) {
      event.preventDefault()
      workspace.activateIndex(Number(key) - 1)
      return
    }
    if (event.shiftKey && (event.key === "[" || event.key === "{")) {
      event.preventDefault()
      workspace.activateAdjacent(-1)
      return
    }
    if (event.shiftKey && (event.key === "]" || event.key === "}")) {
      event.preventDefault()
      workspace.activateAdjacent(1)
    }
  }

  createEffect(() => {
    window.addEventListener("keydown", handleWorkspaceKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleWorkspaceKeyDown))
  })

  return (
    <Show
      when={shouldShowSessionSidePanel({
        isDesktop: isDesktop(),
        newLayoutDesigns: settings.general.newLayoutDesigns(),
        hasSessionID: Boolean(params.id),
        hasWorkspaceTabs: hasWorkspaceTabs(),
      })}
    >
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
        <div
          class="relative min-w-0 h-full flex-1 flex flex-col overflow-hidden"
          classList={{ "border-r border-border-weaker-base": fileOpen() && !settings.general.newLayoutDesigns() }}
        >
          <div class="h-full flex flex-col overflow-hidden">
            <div class="flex flex-col h-full">
                {/* Workspace Tab Bar */}
                <div class="relative shrink-0">
                  <WorkspaceTabBar
                    tabs={workspace.allTabs()}
                    activeTabId={workspace.state.activeTabId}
                    onActivate={workspace.activateTab}
                    onClose={closeWorkspaceTab}
                    onReorder={workspace.reorderTabs}
                    onNewTab={handleNewTab}
                    onOpenFile={handleOpenFile}
                    onPin={workspace.pinTab}
                    onUnpin={workspace.unpinTab}
                    onDuplicate={workspace.duplicateTab}
                    onCloseOthers={closeOtherWorkspaceTabs}
                    onCloseAll={closeAllWorkspaceTabs}
                    onReopenClosed={workspace.reopenClosedTab}
                    canReopenClosed={workspace.canReopenClosedTab()}
                  />

                  <Show when={showNewTabPalette()}>
                    <NewTabPalette
                      onClose={() => setShowNewTabPalette(false)}
                      onOpenBrowser={handleOpenBrowser}
                      onOpenFile={handleOpenFile}
                      onOpenTerminal={handleOpenTerminal}
                      onOpenChat={handleOpenChat}
                    />
                  </Show>
                </div>

                {/* Tab Content - keep all tabs mounted, hide inactive with CSS */}
                <div class="flex-1 min-h-0 overflow-hidden relative">
                  <For each={workspace.allTabs().map((tab) => tab.id)}>
                    {(tabId) => {
                      const tab = createMemo(() => workspace.getTab(tabId))
                      return (
                        <Show when={tab()}>
                          {(item) => (
                            <div
                              class="absolute inset-0 h-full"
                              classList={{ "hidden": !item().isActive }}
                            >
                              <Switch>
                                <Match when={item().type === "review"}>
                                  <div class="h-full flex flex-col">
                                    <Show when={reviewOpen()}>{props.reviewPanel()}</Show>
                                  </div>
                                </Match>
                                <Match when={item().type === "browser"}>
                                  <BrowserTab
                                    title={item().title}
                                    url={tabStateString(item(), "url")}
                                    active={item().isActive}
                                    annotations={tabStateBrowserAnnotations(item())}
                                    onTitleChange={(title) => workspace.updateTab(item().id, { title })}
                                    onUrlChange={(url) => {
                                      workspace.updateTab(item().id, { title: browserTabTitle(url) })
                                      workspace.updateTabState(item().id, { url })
                                    }}
                                    onAnnotationsChange={(annotations) => workspace.updateTabState(item().id, { annotations })}
                                    onSendToChat={handleSendBrowserToChat}
                                    onSendToMainChat={handleSendBrowserToMainChat}
                                  />
                                </Match>
                                <Match when={item().type === "file"}>
                                  <FileTab
                                    filePath={tabStateString(item(), "path") ?? ""}
                                    onSendToChat={handleSendFileToChat}
                                    onSendToMainChat={handleSendFileToMainChat}
                                  />
                                </Match>
                                <Match when={item().type === "terminal"}>
                                  <TerminalTab
                                    active={item().isActive}
                                    ptyId={tabStateString(item(), "ptyId")}
                                    onPtyChange={(ptyId) => workspace.updateTabState(item().id, { ptyId })}
                                    onTitleChange={(title) => workspace.updateTab(item().id, { title })}
                                  />
                                </Match>
                                <Match when={item().type === "chat"}>
                                  <ChatTab
                                    active={item().isActive}
                                    title={item().title}
                                    sessionID={tabStateString(item(), "sessionID")}
                                    agent={tabStateString(item(), "agent")}
                                    modelProviderID={tabStateString(item(), "modelProviderID")}
                                    modelID={tabStateString(item(), "modelID")}
                                    modelVariant={tabStateString(item(), "modelVariant")}
                                    contextUrl={tabStateString(item(), "contextUrl")}
                                    contextTitle={tabStateString(item(), "contextTitle")}
                                    contextAnnotations={tabStateBrowserAnnotations(item(), "contextAnnotations")}
                                    contextFilePath={tabStateString(item(), "contextFilePath")}
                                    onSessionChange={(sessionID) => workspace.updateTabState(item().id, { sessionID })}
                                    onTitleChange={(title) => workspace.updateTab(item().id, { title })}
                                    onSelectionChange={(selection) => workspace.updateTabState(item().id, selection)}
                                    onContextChange={(context) => workspace.updateTabState(item().id, context)}
                                    onSendDraftToMainChat={appendTextToMainPrompt}
                                  />
                                </Match>
                              </Switch>
                            </div>
                          )}
                        </Show>
                      )
                    }}
                  </For>
                </div>
              </div>
          </div>
        </div>

        <Show when={shown()}>
          <div
            id="file-tree-panel"
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
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weaker-base": reviewOpen() }}
            >
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
              >
                <div class="flex items-center justify-between px-3 pt-2.5 shrink-0">
                  <Tabs.List>
                    <Tabs.Trigger value="changes">
                      {language.t("session.fileTree.changes")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="all">
                      {language.t("session.fileTree.allFiles")}
                    </Tabs.Trigger>
                  </Tabs.List>
                </div>
                <Tabs.Content value="changes" class="flex flex-col h-full overflow-hidden">
                  <Switch fallback={empty(language.t("session.files.empty"))}>
                    <Match when={!props.diffsReady()}>{empty(language.t("session.files.loading"))}</Match>
                    <Match when={!props.canReview()}>{empty(language.t("session.review.cannotReview"))}</Match>
                    <Match when={!diffs().length}>{empty(language.t("session.review.noChanges"))}</Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="flex flex-col h-full overflow-hidden">
                  <Switch>
                    <Match when={!file.tree.state("").loaded}>{empty(language.t("session.files.loading"))}</Match>
                    <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                    <Match when={true}>
                      <FileTree
                        path=""
                        class="pt-3"
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => {
                          workspace.openTab("file", {
                            title: node.name,
                            state: { path: node.path },
                          })
                        }}
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
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
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
      </aside>
    </Show>
  )
}
