import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon } from "@opencode-ai/ui/icon"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Select } from "@opencode-ai/ui/select"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { Persist, persisted } from "@/utils/persist"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, getTabReorderIndex } from "@/pages/session/helpers"
import { StickyAddButton } from "@/pages/session/review-tab"
import { setSessionHandoff } from "@/pages/session/handoff"

type LibraryCommand = {
  name: string
  title?: string
  description?: string
  summary?: string
  template: string
  agent?: string
  category: string
  icon?: string
  tags: string[]
  source?: string
}

type LibraryAgent = {
  name: string
  title?: string
  description?: string
  summary?: string
  category: string
  icon?: string
  tags: string[]
  mode?: string
  hidden?: boolean
}

type HoverItem = {
  kind: "command" | "agent"
  title: string
  summary?: string
  description?: string
  category: string
  icon?: string
  tags: string[]
}

const normalizePath = (value: string) => value.replaceAll("\\", "/")
const joinPath = (base: string, part: string) => `${normalizePath(base).replace(/\/+$/, "")}/${part}`
const label = (value: string) => value.split("/").filter(Boolean).at(-1) ?? value
const title = (value: string) =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      const word = part.toLowerCase()
      if (["ai", "qa", "api", "pr", "ux", "ui", "db", "cli", "lsp", "mcp", "sdk"].includes(word)) {
        return word.toUpperCase()
      }
      return part.slice(0, 1).toUpperCase() + part.slice(1)
    })
    .join(" ")
const display = (item: { title?: string; name: string }) =>
  item.title ? title(item.title.replaceAll("/", " ")) : title(label(item.name))
const agentAlias: Record<string, string> = {
  docs: "documentation",
  planning: "plan",
}
const canonicalAgent = (value: string) => agentAlias[value] ?? value
const categoryName = (value?: string) =>
  value
    ? value.toLowerCase() === "qa"
      ? "QA"
      : value.toLowerCase() === "ai"
        ? "AI"
        : value
            .split(/[-_]/g)
            .filter(Boolean)
            .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
            .join(" ")
    : "General"
const categoryIcon = (category: string, items: LibraryCommand[]) => {
  if (category === "General") return "opencode"
  const value = items.find((item) => !!item.icon)?.icon
  if (value) return value
  if (category === "AI") return "🤖"
  return ""
}
const commandRank = (item: LibraryCommand) => {
  if (item.name === "create-new-command") return 0
  if (item.name === "create-new-agent") return 1
  return 10
}
const isCreate = (name: string) => {
  const value = label(name)
  return value === "create-new-command" || value === "create-new-agent"
}

function renderPromptTemplate(template: string, values: { selection: string; clipboard: string }) {
  return template.replaceAll("{{selection}}", values.selection).replaceAll("{{clipboard}}", values.clipboard)
}

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
  const sdk = useSDK()
  const prompt = usePrompt()
  const platform = usePlatform()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const open = createMemo(
    () => isDesktop() && (view().reviewPanel.opened() || layout.fileTree.opened() || layout.fileTree.promptOpened()),
  )
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
    promptSearch: "",
    promptList: [] as LibraryCommand[],
    agentList: [] as LibraryAgent[],
    selectedAgent: "",
    hover: undefined as HoverItem | undefined,
    hoverX: 0,
    hoverY: 0,
  })
  const [pref, setPref] = persisted(
    Persist.global("layout.prompt", ["layout.prompt.v1"]),
    createStore({
      category: {} as Record<string, boolean>,
    }),
  )

  let changesEl: HTMLDivElement | undefined
  let allEl: HTMLDivElement | undefined

  const syncFileTreeScrolled = (el?: HTMLDivElement) => {
    const next = (el?.scrollTop ?? 0) > 0
    setStore("fileTreeScrolled", (current) => (current === next ? current : next))
  }

  const promptRoot = createMemo(() => joinPath(sdk.directory, ".opencode/command"))
  const agentRoot = createMemo(() => joinPath(sdk.directory, ".opencode/agent"))
  const promptOpen = createMemo(() => layout.fileTree.promptOpened())
  const promptHeight = createMemo(() => layout.fileTree.promptHeight())
  const treeHeight = createMemo(() => (promptOpen() ? `calc(100% - ${promptHeight()}px)` : "100%"))
  const currentAgent = createMemo(() => sync.data.config.default_agent ?? "build")
  const activeAgent = createMemo(() => canonicalAgent(store.selectedAgent || currentAgent()))
  const hoverPos = createMemo(() => {
    if (typeof window === "undefined") return { left: 8, top: 8 }
    const w = 360
    const h = 220
    const pad = 8
    const dx = 14
    const dy = 14
    const right = store.hoverX + dx + w > window.innerWidth
    const down = store.hoverY + dy + h > window.innerHeight
    const x = right ? store.hoverX - w - dx : store.hoverX + dx
    const y = down ? store.hoverY - h - dy : store.hoverY + dy
    return {
      left: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
    }
  })

  createEffect(() => {
    const list = sync.data.command
      .filter((item) => typeof item?.name === "string" && typeof item?.template === "string")
      .map((item: any) => ({
        name: item.name,
        title: item.title,
        description: item.description,
        summary: item.summary,
        template: item.template,
        agent: item.agent,
        category: categoryName(item.category),
        icon: item.icon,
        tags: item.tags ?? [],
        source: item.source,
      }))
      .sort((a, b) => {
        const rank = commandRank(a) - commandRank(b)
        if (rank !== 0) return rank
        return display(a).localeCompare(display(b))
      })
    setStore("promptList", list)
  })

  createEffect(() => {
    const list = sync.data.agent
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item: any) => ({
        name: canonicalAgent(item.name),
        title: item.name === canonicalAgent(item.name) ? item.title : undefined,
        description: item.description,
        summary: item.summary,
        category: categoryName(item.category),
        icon: item.icon,
        tags: item.tags ?? [],
        mode: item.mode,
        hidden: item.hidden,
      }))
    const map = new Map<string, (typeof list)[number]>()
    for (const item of list) {
      const curr = map.get(item.name)
      if (!curr) {
        map.set(item.name, item)
        continue
      }
      const currScore = Number(!!curr.icon) + Number(!!curr.title) + Number(!!curr.summary)
      const nextScore = Number(!!item.icon) + Number(!!item.title) + Number(!!item.summary)
      if (nextScore > currScore) map.set(item.name, item)
    }
    setStore(
      "agentList",
      Array.from(map.values()).sort((a, b) => display(a).localeCompare(display(b))),
    )
  })

  const agentChoices = createMemo(() => {
    const map = new Map(store.agentList.map((item) => [item.name, item]))
    for (const value of store.promptList.map((item) => item.agent).filter((item): item is string => !!item)) {
      const name = canonicalAgent(value)
      if (map.has(name)) continue
      map.set(name, {
        name,
        title: title(label(name)),
        category: "General",
        tags: [],
      })
    }
    return Array.from(map.values()).toSorted((a, b) => display(a).localeCompare(display(b)))
  })

  createEffect(() => {
    if (store.selectedAgent) return
    const next =
      agentChoices().find((item) => item.name === "build")?.name ??
      agentChoices().find((item) => item.name === canonicalAgent(currentAgent()))?.name ??
      agentChoices()[0]?.name ??
      store.agentList[0]?.name
    if (!next) return
    setStore("selectedAgent", next)
  })

  const promptFiltered = createMemo(() => {
    const q = store.promptSearch.trim().toLowerCase()
    if (!q) return store.promptList
    return store.promptList.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      if (display(item).toLowerCase().includes(q)) return true
      if (item.summary?.toLowerCase().includes(q)) return true
      if (item.description?.toLowerCase().includes(q)) return true
      if (item.category.toLowerCase().includes(q)) return true
      if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true
      return item.template.toLowerCase().includes(q)
    })
  })

  const promptGrouped = createMemo(() => {
    const root = new Set(["create-new-command", "create-new-agent"])
    const map = new Map<string, LibraryCommand[]>()
    for (const item of promptFiltered()) {
      if (root.has(label(item.name))) continue
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  })

  const rootCommands = createMemo(() => {
    const root = new Set(["create-new-command", "create-new-agent"])
    return promptFiltered()
      .filter((item) => root.has(label(item.name)))
      .toSorted((a, b) => commandRank(a) - commandRank(b))
  })

  const agentSorted = createMemo(() => agentChoices())
  const agentNames = createMemo(() => agentSorted().map((item) => item.name))
  const agentMap = createMemo(() => new Map(agentSorted().map((item) => [item.name, item])))

  const togglePromptCategory = (category: string) => {
    setPref("category", category, (value) => !(value ?? false))
  }

  const isPromptCategoryOpen = (category: string) => {
    if (store.promptSearch) return true
    return pref.category[category] ?? false
  }

  const selectedText = () => {
    const active = tabs().active()
    if (!active) return ""
    const path = file.pathFromTab(active)
    if (!path) return ""
    const range = file.selectedLines(path)
    if (!range || typeof range !== "object") return ""
    if (!("startLine" in range) || !("endLine" in range)) return ""
    const content = file.get(path)?.content?.content
    if (!content) return ""
    const startLine = Number(range.startLine)
    const endLine = Number(range.endLine)
    const start = Math.max(1, Math.min(startLine, endLine))
    const end = Math.max(startLine, endLine)
    return content
      .split("\n")
      .slice(start - 1, end)
      .join("\n")
  }

  const applyPrompt = (item: LibraryCommand) => {
    const text = renderPromptTemplate(item.template, {
      selection: selectedText(),
      clipboard: "",
    })
    const value = activeAgent() ? `@${activeAgent()}\n${text}` : text
    prompt.set(
      [
        {
          type: "text",
          content: value,
          start: 0,
          end: value.length,
        },
      ],
      value.length,
    )
    showToast({
      variant: "success",
      title: "Command inserted",
      description: display(item),
    })
  }

  const setHover = (event: MouseEvent, item: LibraryCommand | LibraryAgent, kind: "command" | "agent") => {
    setStore("hover", {
      kind,
      title: display(item),
      summary: item.summary,
      description: item.description,
      category: item.category,
      icon: kind === "command" && isCreate(item.name) ? "plus" : item.icon,
      tags: item.tags,
    })
    setStore("hoverX", event.clientX)
    setStore("hoverY", event.clientY)
  }

  const openPromptFolder = () => {
    if (!platform.openPath) {
      showToast({ variant: "default", title: "Open folder not available" })
      return
    }
    platform.openPath(promptRoot()).catch((error) => {
      showToast({
        variant: "error",
        title: "Failed to open command folder",
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const openAgentFolder = () => {
    if (!platform.openPath) {
      showToast({ variant: "default", title: "Open folder not available" })
      return
    }
    platform.openPath(agentRoot()).catch((error) => {
      showToast({
        variant: "error",
        title: "Failed to open agent folder",
        description: error instanceof Error ? error.message : String(error),
      })
    })
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

        <Show when={layout.fileTree.opened() || promptOpen()}>
          <div id="file-tree-panel" class="relative shrink-0 h-full" style={{ width: `${layout.fileTree.width()}px` }}>
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": reviewOpen() }}
            >
              <Show when={layout.fileTree.opened()}>
                <div class="min-h-0" style={{ height: treeHeight() }}>
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
                      onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) =>
                        syncFileTreeScrolled(e.currentTarget)
                      }
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
                      onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) =>
                        syncFileTreeScrolled(e.currentTarget)
                      }
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
              </Show>

              <Show when={promptOpen()}>
                <div
                  id="prompt-library-panel"
                  class="relative shrink-0"
                  classList={{ "border-t border-border-weak-base": layout.fileTree.opened() }}
                  style={{ height: layout.fileTree.opened() ? `${promptHeight()}px` : "100%" }}
                >
                  <Show when={layout.fileTree.opened()}>
                    <ResizeHandle
                      direction="vertical"
                      edge="start"
                      size={promptHeight()}
                      min={140}
                      max={typeof window === "undefined" ? 700 : window.innerHeight * 0.6}
                      collapseThreshold={90}
                      onResize={layout.fileTree.resizePrompt}
                      onCollapse={layout.fileTree.togglePrompt}
                    />
                  </Show>
                  <div class="h-full bg-background-stronger px-3 py-2 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <div class="flex items-center gap-1 text-12-medium text-text-weak uppercase tracking-wide">
                        <Icon name="prompt" size="small" />
                        Library
                      </div>
                      <button
                        type="button"
                        class="ml-auto h-7 px-2 rounded-md border border-border-weak-base text-text-weak hover:text-text-strong hover:bg-surface-base-hover flex items-center justify-center text-11-medium"
                        title="Open commands folder"
                        onClick={openPromptFolder}
                      >
                        Commands
                      </button>
                      <button
                        type="button"
                        class="h-7 px-2 rounded-md border border-border-weak-base text-text-weak hover:text-text-strong hover:bg-surface-base-hover flex items-center justify-center text-11-medium"
                        title="Open agents folder"
                        onClick={openAgentFolder}
                      >
                        Agents
                      </button>
                    </div>

                    <div class="flex items-center gap-2">
                      <Select
                        options={agentNames()}
                        current={activeAgent()}
                        label={(item) => {
                          const value = agentMap().get(item)
                          return `${value?.icon ? `${value.icon} ` : ""}${value ? display(value) : title(label(item))}`
                        }}
                        onSelect={(item) => {
                          if (!item) return
                          setStore("selectedAgent", item)
                        }}
                        size="small"
                        variant="secondary"
                        triggerClass="w-full"
                        valueClass="truncate text-12-medium"
                      />
                    </div>

                    <input
                      value={store.promptSearch}
                      onInput={(event) => setStore("promptSearch", event.currentTarget.value)}
                      placeholder="Search library commands"
                      class="w-full h-7 px-2 rounded-md border border-border-weak-base bg-surface-panel text-13-regular outline-none"
                    />

                    <div class="text-11-regular text-text-dim">Hover a command for details.</div>

                    <div class="min-h-0 overflow-auto pr-1" data-scrollable>
                      <Show
                        when={promptFiltered().length > 0}
                        fallback={<div class="text-12-regular text-text-weak">No commands found.</div>}
                      >
                        <For each={promptGrouped()}>
                          {([category, items]) => (
                            <div class="mb-2">
                              <button
                                type="button"
                                class="w-full flex items-center gap-1 text-left text-12-medium text-text-weak hover:text-text-strong"
                                onClick={() => togglePromptCategory(category)}
                              >
                                <span>{isPromptCategoryOpen(category) ? "▼" : "▶"}</span>
                                <span class="inline-flex items-center gap-1">
                                  <Show
                                    when={categoryIcon(category, items) === "opencode"}
                                    fallback={<span>{categoryIcon(category, items)}</span>}
                                  >
                                    <Mark class="size-3.5 opacity-80" />
                                  </Show>
                                  <span>{category}</span>
                                </span>
                                <span class="text-text-dim">({items.length})</span>
                              </button>
                              <Show when={isPromptCategoryOpen(category)}>
                                <div class="mt-1 flex flex-col gap-1">
                                  <For each={items}>
                                    {(item) => (
                                      <ContextMenu>
                                        <ContextMenu.Trigger
                                          as="button"
                                          type="button"
                                          class="w-full text-left px-2 py-1.5 rounded-md border border-transparent hover:border-border-weak-base hover:bg-surface-base-hover"
                                          onClick={() => void applyPrompt(item)}
                                          onMouseEnter={(event: MouseEvent) => setHover(event, item, "command")}
                                          onMouseMove={(event: MouseEvent) => setHover(event, item, "command")}
                                          onMouseLeave={() => setStore("hover", undefined)}
                                        >
                                          <div class="text-12-medium text-text-strong truncate">
                                            {item.icon ? `${item.icon} ` : ""}
                                            {display(item)}
                                          </div>
                                          <Show when={item.summary ?? item.description}>
                                            <div class="text-11-regular text-text-weak truncate">
                                              {item.summary ?? item.description}
                                            </div>
                                          </Show>
                                        </ContextMenu.Trigger>
                                        <ContextMenu.Portal>
                                          <ContextMenu.Content>
                                            <ContextMenu.Item onSelect={() => void applyPrompt(item)}>
                                              <ContextMenu.ItemLabel>Insert command</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                            <ContextMenu.Item
                                              onSelect={() => {
                                                navigator.clipboard.writeText(item.template).catch(() => {})
                                              }}
                                            >
                                              <ContextMenu.ItemLabel>Copy template</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                            <ContextMenu.Item onSelect={openPromptFolder}>
                                              <ContextMenu.ItemLabel>Open commands folder</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                          </ContextMenu.Content>
                                        </ContextMenu.Portal>
                                      </ContextMenu>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>

                        <Show when={rootCommands().length > 0}>
                          <div class="mt-2 flex flex-col gap-1">
                            <For each={rootCommands()}>
                              {(item) => (
                                <ContextMenu>
                                  <ContextMenu.Trigger
                                    as="button"
                                    type="button"
                                    class="w-full text-left py-0.5 text-12-medium text-text-strong hover:text-text-interactive-base"
                                    onClick={() => void applyPrompt(item)}
                                    onMouseEnter={(event: MouseEvent) => setHover(event, item, "command")}
                                    onMouseMove={(event: MouseEvent) => setHover(event, item, "command")}
                                    onMouseLeave={() => setStore("hover", undefined)}
                                  >
                                    <span class="inline-flex items-center gap-1">
                                      <Icon name="plus-small" size="small" class="text-icon-success-base" />
                                      <span>{display(item)}</span>
                                    </span>
                                  </ContextMenu.Trigger>
                                  <ContextMenu.Portal>
                                    <ContextMenu.Content>
                                      <ContextMenu.Item onSelect={() => void applyPrompt(item)}>
                                        <ContextMenu.ItemLabel>Insert command</ContextMenu.ItemLabel>
                                      </ContextMenu.Item>
                                      <ContextMenu.Item
                                        onSelect={() => {
                                          navigator.clipboard.writeText(item.template).catch(() => {})
                                        }}
                                      >
                                        <ContextMenu.ItemLabel>Copy template</ContextMenu.ItemLabel>
                                      </ContextMenu.Item>
                                    </ContextMenu.Content>
                                  </ContextMenu.Portal>
                                </ContextMenu>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>

                    <Show when={store.hover}>
                      {(item) => (
                        <div
                          class="fixed z-50 pointer-events-none rounded-md border border-border-strong-base bg-background-stronger px-2 py-1.5 shadow-lg max-w-80 opacity-100"
                          style={{ left: `${hoverPos().left}px`, top: `${hoverPos().top}px` }}
                        >
                          <div class="flex items-center gap-1 text-11-medium text-text-weak">
                            <Show
                              when={item().icon === "plus"}
                              fallback={<span>{item().icon ?? (item().kind === "command" ? "⌘" : "@")}</span>}
                            >
                              <Icon name="plus-small" size="small" class="text-icon-success-base" />
                            </Show>
                            <span class="uppercase tracking-wide">{item().kind}</span>
                            <span class="text-text-dim">•</span>
                            <span>{item().category}</span>
                          </div>
                          <div class="text-12-medium text-text-strong">{item().title}</div>
                          <Show when={item().summary ?? item().description}>
                            <div class="text-11-regular text-text-weak">{item().summary ?? item().description}</div>
                          </Show>
                          <Show when={item().tags.length > 0}>
                            <div class="mt-1 flex flex-wrap gap-1">
                              <For each={item().tags.slice(0, 5)}>
                                {(tag) => (
                                  <span class="text-10-medium text-text-dim px-1.5 py-0.5 rounded border border-border-weak-base">
                                    {tag}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              </Show>
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
