/**
 * Tab Review Content
 *
 * Code review/diff view rendered as a full tab.
 * Extracted from session.tsx for use in the Claxedo tab-based layout.
 * Includes a right sidebar with "Changes" and "All Files" tabs like the original.
 */

import {
  For,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
} from "solid-js"
import { createStore } from "solid-js/store"

import { useSync, useFile, useComments } from "@opencode-ai/claxedo-app"
import {
  SessionReview,
  type SessionReviewLineComment,
} from "@opencode-ai/ui/session-review"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Mark } from "@opencode-ai/ui/logo"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import FileTree from "@/components/file-tree"
import { getFilename, getDirectory } from "@opencode-ai/util/path"
import type { FileDiff, FileContent } from "@opencode-ai/sdk/v2"

export type TabReviewProps = {
  sessionId: string
  /**
   * Callback when viewing a file
   */
  onViewFile?: (path: string) => void
  /**
   * Custom class name
   */
  class?: string
}

export function TabReview(props: TabReviewProps) {
  const sync = useSync()
  const file = useFile()
  const comments = useComments()

  const [store, setStore] = createStore({
    openDiffs: [] as string[],
    diffStyle: "unified" as "unified" | "split",
    sidebarOpen: true,
    sidebarTab: "changes" as "changes" | "all",
    focusedFile: undefined as string | undefined,
  })

  let reviewScrollRef: HTMLDivElement | undefined

  createEffect(() => {
    const id = props.sessionId
    if (!id) return
    if (id === "new") return
    void sync.session.sync(id)
  })

  createEffect(() => {
    const id = props.sessionId
    if (!id) return
    if (id === "new") return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return
    void sync.session.diff(id)
  })

  // Load file tree when "all" tab is active
  createEffect(() => {
    if (store.sidebarTab !== "all") return
    if (!store.sidebarOpen) return
    void file.tree.list("")
  })

  // Session data
  const info = createMemo(() => sync.session.get(props.sessionId))
  const messages = createMemo(() => sync.data.message[props.sessionId] ?? [])

  // Compute diffs from sync data
  const diffs = createMemo((): FileDiff[] => {
    return sync.data.session_diff[props.sessionId] ?? []
  })

  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const diffsReady = createMemo(() => messages().length > 0 || info() !== undefined)
  const hasReview = createMemo(() => diffs().length > 0)

  const reviewCount = createMemo(() => diffs().length)

  const totalChanges = createMemo(() => {
    const d = diffs()
    return {
      additions: d.reduce((acc, f) => acc + (f.additions ?? 0), 0),
      deletions: d.reduce((acc, f) => acc + (f.deletions ?? 0), 0),
    }
  })

  // File content reader
  const readFile = async (path: string): Promise<FileContent | undefined> => {
    const result = await file.load(path)
    const state = file.get(path)
    return state?.content
  }

  // Comments integration
  const handleLineComment = (comment: SessionReviewLineComment) => {
    comments.add({
      file: comment.file,
      selection: comment.selection,
      comment: comment.comment,
    })
  }

  const handleViewFile = (path: string) => {
    file.load(path)
    props.onViewFile?.(path)
  }

  const handleOpenChange = (open: string[]) => {
    setStore("openDiffs", open)
  }

  // Scroll to and focus a specific file
  const focusFile = (filePath: string) => {
    setStore("focusedFile", filePath)
    // Ensure the file is expanded
    if (!store.openDiffs.includes(filePath)) {
      setStore("openDiffs", [...store.openDiffs, filePath])
    }
    // Scroll to the file after a short delay to allow expansion
    requestAnimationFrame(() => {
      const el = reviewScrollRef?.querySelector(`[data-file="${filePath}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    })
  }

  const toggleSidebar = () => {
    setStore("sidebarOpen", !store.sidebarOpen)
  }

  const handleTabChange = (value: string) => {
    if (value === "changes" || value === "all") {
      setStore("sidebarTab", value)
    }
  }

  return (
    <div class={`relative flex size-full min-h-0 overflow-hidden bg-background-base ${props.class ?? ""}`}>
      {/* Main content area */}
      <div class="flex-1 min-w-0 flex flex-col h-full">
        {/* Header - minimal, just diff style toggle */}
        <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-border-weak-base bg-background-stronger flex-shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex items-center gap-2 text-sm font-medium text-text-strong min-w-0">
              <span>Review</span>
              <Show when={reviewCount() > 0}>
                <span class="flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-medium text-text-strong bg-surface-base rounded-full">
                  {reviewCount()}
                </span>
              </Show>
            </div>
            <Show when={hasReview()}>
              <DiffChanges changes={totalChanges()} class="flex-shrink-0" />
            </Show>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            <Show when={hasReview()}>
              {/* Diff style toggle */}
              <div class="flex items-center gap-0.5 p-0.5 bg-surface-base rounded-md">
                <Tooltip value="Unified view">
                  <div class="flex items-center">
                    <IconButton
                      icon="code-lines"
                      variant={store.diffStyle === "unified" ? "secondary" : "ghost"}
                      onClick={() => setStore("diffStyle", "unified")}
                      aria-label="Unified view"
                    />
                  </div>
                </Tooltip>
                <Tooltip value="Split view">
                  <div class="flex items-center">
                    <IconButton
                      icon="layout-right"
                      variant={store.diffStyle === "split" ? "secondary" : "ghost"}
                      onClick={() => setStore("diffStyle", "split")}
                      aria-label="Split view"
                    />
                  </div>
                </Tooltip>
              </div>

              {/* Sidebar toggle */}
              <Tooltip value={store.sidebarOpen ? "Hide file panel" : "Show file panel"}>
                <div class="flex items-center">
                  <IconButton
                    icon={store.sidebarOpen ? "layout-right-full" : "layout-right"}
                    variant="ghost"
                    onClick={toggleSidebar}
                    aria-label={store.sidebarOpen ? "Hide file panel" : "Show file panel"}
                  />
                </div>
              </Tooltip>
            </Show>
          </div>
        </div>

        {/* Content */}
        <div class="flex-1 min-h-0 overflow-auto" ref={reviewScrollRef}>
          <Switch>
            <Match when={hasReview()}>
              <Show
                when={diffsReady()}
                fallback={
                  <div class="px-4 py-6 text-text-weak">Loading changes...</div>
                }
              >
                <SessionReview
                  diffs={diffs()}
                  diffStyle={store.diffStyle}
                  comments={comments.all()}
                  open={store.openDiffs}
                  onOpenChange={handleOpenChange}
                  readFile={readFile}
                  onLineComment={handleLineComment}
                  onViewFile={handleViewFile}
                  focusedFile={store.focusedFile}
                  classes={{
                    root: "h-full",
                    header: "px-4",
                    container: "px-4",
                  }}
                />
              </Show>
            </Match>

            <Match when={true}>
              <div class="flex flex-col items-center justify-center h-full min-h-[300px] px-6 pt-8 pb-30 text-center gap-6">
                <Mark class="w-14 opacity-10" />
                <div class="text-13-regular text-text-weak max-w-56">
                  No changes in this session yet
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </div>

      {/* Right sidebar - File panel with tabs */}
      <Show when={store.sidebarOpen}>
        <aside class="flex flex-col w-72 min-w-56 max-w-96 h-full border-l border-border-weak-base bg-background-base shrink-0">
          <Tabs
            variant="pill"
            value={store.sidebarTab}
            onChange={handleTabChange}
            class="h-full flex flex-col"
          >
            {/* Tab list header */}
            <div class="flex items-center justify-between px-3 py-2 border-b border-border-weak-base bg-background-stronger">
              <Tabs.List class="flex-1">
                <Tabs.Trigger value="changes">
                  Changes
                  <Show when={reviewCount() > 0}>
                    <span class="ml-1 text-xs text-text-weak">({reviewCount()})</span>
                  </Show>
                </Tabs.Trigger>
                <Tabs.Trigger value="all">All Files</Tabs.Trigger>
              </Tabs.List>
            </div>

            {/* Changes tab content */}
            <Tabs.Content value="changes" class="flex-1 min-h-0 overflow-auto">
              <Show
                when={hasReview()}
                fallback={
                  <div class="flex flex-col items-center justify-center h-full p-6 text-center">
                    <div class="text-13-regular text-text-weak">No changes yet</div>
                  </div>
                }
              >
                <div class="py-1">
                  <For each={diffs()}>
                    {(diff) => {
                      const isExpanded = () => store.openDiffs.includes(diff.file)
                      const isFocused = () => store.focusedFile === diff.file
                      const filename = () => getFilename(diff.file)
                      const directory = () => getDirectory(diff.file)

                      return (
                        <button
                          type="button"
                          class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-base-hover transition-colors group"
                          classList={{
                            "bg-surface-base": isFocused(),
                          }}
                          onClick={() => focusFile(diff.file)}
                        >
                          <FileIcon node={{ path: diff.file, type: "file" }} class="shrink-0" />
                          <div class="flex-1 min-w-0 flex flex-col">
                            <span class="text-13-regular text-text-base truncate">{filename()}</span>
                            <Show when={directory()}>
                              <span class="text-11-regular text-text-weak truncate">{directory()}</span>
                            </Show>
                          </div>
                          <DiffChanges changes={diff} class="shrink-0 text-xs" />
                          <Show when={isExpanded()}>
                            <Icon name="check-small" size="small" class="text-icon-weak shrink-0" />
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </div>
                {/* Footer with totals */}
                <div class="sticky bottom-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-border-weak-base bg-background-base text-xs text-text-weak">
                  <span>{reviewCount()} files</span>
                  <DiffChanges changes={totalChanges()} />
                </div>
              </Show>
            </Tabs.Content>

            {/* All Files tab content */}
            <Tabs.Content value="all" class="flex-1 min-h-0 overflow-auto bg-background-base px-3 py-0">
              <FileTree
                path=""
                modified={diffFiles()}
                onFileClick={(node) => handleViewFile(node.path)}
              />
            </Tabs.Content>
          </Tabs>
        </aside>
      </Show>
    </div>
  )
}

/**
 * Compact review summary for use in tab headers or sidebars
 */
export function ReviewSummary(props: { sessionId: string; class?: string }) {
  const sync = useSync()

  const info = createMemo(() => sync.session.get(props.sessionId))
  const summary = createMemo(() => info()?.summary)

  return (
    <Show when={summary()}>
      {(s) => (
        <div class={`flex items-center gap-2 text-xs text-text-weak ${props.class ?? ""}`}>
          <Show when={s().files}>
            <span class="text-text-base">{s().files} files</span>
          </Show>
          <DiffChanges
            changes={{
              additions: s().additions ?? 0,
              deletions: s().deletions ?? 0,
            }}
          />
        </div>
      )}
    </Show>
  )
}
