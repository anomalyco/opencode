import { Toast, showToast } from "@opencode-ai/ui/toast"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createEffect, createMemo, createSignal, Switch, Match, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Titlebar } from "@/components/titlebar"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogSettings } from "@/components/dialog-settings"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import FileTree from "@/components/file-tree"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { SessionProviders } from "@/app"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

function avatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as (typeof AVATAR_COLOR_KEYS)[number])) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

function SidebarContent() {
  const params = useParams()
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const language = useLanguage()

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))

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

  const openReviewPanel = () => {}

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const dialog = useDialog()
  const fileTreeTab = () => layout.fileTree.tab()

  const tabName = createMemo(() => {
    const t = fileTreeTab()
    if (t === "changes") return "Audit"
    if (t === "dashboards") return "Dashboards"
    if (t === "workflows") return "Workflows"
    return "Files"
  })

  return (
    <div class="w-72 border-r border-border-weak-base flex h-full min-h-0 min-w-0 flex-col bg-background-base">
      <div class="h-12 border-b border-border-weak-base px-4 flex items-center justify-between shrink-0 bg-background-stronger">
        <span class="text-14-medium text-text-strong">{tabName()}</span>
        <div class="flex items-center gap-1">
          <IconButton
            icon="folder-add-left"
            variant="ghost"
            class="size-8 rounded-md"
            onClick={() => showToast({ variant: "success", title: "Create folder coming soon" })}
            aria-label="Create folder"
          />
          <IconButton
            icon="plus-small"
            variant="ghost"
            class="size-8 rounded-md"
            onClick={() => dialog.show(() => <DialogSelectFile mode="files" onOpenFile={() => layout.fileTree.setTab("all")} />)}
            aria-label="Add file"
          />
        </div>
      </div>
      <Tabs value={fileTreeTab()} class="h-full flex flex-col" data-scope="filetree">
        <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0 flex-1 overflow-y-auto no-scrollbar">
          <Switch>
            <Match when={hasReview()}>
              <Show
                when={diffsReady()}
                fallback={
                  <div class="px-2 py-2 text-12-regular text-text-weak">
                    {language.t("common.loading")}...
                  </div>
                }
              >
                <FileTree
                  path=""
                  class="pt-3"
                  allowed={diffFiles()}
                  kinds={kinds()}
                  draggable={false}
                  onFileClick={(node) => openTab(file.tab(node.path))}
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
        <Tabs.Content value="all" class="bg-background-stronger px-3 py-0 flex-1 overflow-y-auto no-scrollbar">
          <Switch>
            <Match when={nofiles()}>
              <FileTree
                path=""
                class="pt-3"
                droppable={true}
                emptyActions={true}
                onFileClick={(node) => openTab(file.tab(node.path))}
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
  )
}

function Sidebar() {
  const layout = useLayout()
  const params = useParams()
  const dialog = useDialog()
  const platform = usePlatform()
  const current = createMemo(() => params.dir ?? "")

  const items = [
    {
      id: "all",
      name: "Files",
      icon: <Icon name="copy" class="size-5" />
    },
    {
      id: "dashboards",
      name: "Dashboards",
      icon: (
        <svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
          <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
          <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
          <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
        </svg>
      )
    },
    {
      id: "workflows",
      name: "Workflows",
      icon: (
        <svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="14" cy="5" r="1.5" fill="currentColor" />
          <circle cx="6" cy="10" r="1.5" fill="currentColor" />
          <circle cx="14" cy="15" r="1.5" fill="currentColor" />
          <path d="M14 5H9a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h5" />
        </svg>
      )
    },
    {
      id: "changes",
      name: "Audit",
      icon: (
        <svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 2s6 2 6 6v5c0 4-6 6-6 6s-6-2-6-6V8c0-4 6-6 6-6z" />
          <path d="m8 10 1.5 1.5 2.5-2.5" stroke-width="2" />
        </svg>
      )
    }
  ]

  return (
    <aside class="shrink-0 bg-background-base flex h-full min-h-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden border-r border-border-weak-base"
      >
        <div class="flex-1 min-h-0 w-full">
          <Show when={current()}>
            <div class="h-full w-full flex flex-col items-center gap-4 px-2 py-4 overflow-y-auto no-scrollbar">
              <For each={items}>
                {(item) => (
                  <button
                    type="button"
                    class="flex flex-col items-center justify-center w-full py-2.5 rounded-lg transition-all duration-200 cursor-pointer relative"
                    classList={{
                      "bg-surface-base-active text-text-strong": layout.fileTree.tab() === item.id,
                      "text-text-weak hover:text-text-strong hover:bg-surface-base-hover": layout.fileTree.tab() !== item.id,
                    }}
                    onClick={() => {
                      const target = item.id as any
                      if (layout.fileTree.tab() === target && layout.sidebar.opened()) {
                        layout.sidebar.close()
                      } else {
                        layout.fileTree.setTab(target)
                        layout.sidebar.open()
                      }
                    }}
                  >
                    {item.icon}
                    <span class="text-[9px] mt-1 font-medium">{item.name}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <IconButton
            icon="settings-gear"
            variant="ghost"
            size="large"
            onClick={() => dialog.show(() => <DialogSettings />)}
            aria-label="Settings"
          />
          <IconButton
            icon="help"
            variant="ghost"
            size="large"
            onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
            aria-label="Help"
          />
        </div>
      </div>

      <Show when={layout.sidebar.opened() && current()}>
        <SDKProvider directory={current}>
          <SyncProvider>
            <SessionProviders>
              <SidebarContent />
            </SessionProviders>
          </SyncProvider>
        </SDKProvider>
      </Show>
    </aside>
  )
}

export default function Layout(props: ParentProps) {
  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col">
      <Titlebar />
      <div class="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        <Sidebar />
        <main class="flex-1 min-h-0 min-w-0 overflow-hidden">{props.children}</main>
      </div>
      <Toast.Region />
    </div>
  )
}
