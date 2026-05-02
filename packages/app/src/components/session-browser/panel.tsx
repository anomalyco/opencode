import { For, Show, createMemo } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DirectoryNode } from "./directory-node"
import type { TreeNode } from "./directory-node"
import type { Session } from "@opencode-ai/sdk/v2/client"

export type ViewMode = "directories" | "projects"

export type PanelProps = {
  directories: Array<{ directory: string; count: number }>
  projectCounts: Array<{ project_id: string; count: number; worktree: string | null; name: string | null }>
  sessionsByDir: Record<string, Session[]>
  metaByDir: Record<string, { loading: boolean; cursor?: number; complete: boolean }>
  currentSessionId?: string
  expandedDirs: Record<string, boolean>
  sessionsVisible: Record<string, boolean>
  onToggleDir: (directory: string) => void
  onToggleSessions: (directory: string) => void
  onSelectSession: (directory: string, sessionId: string) => void
  onLoadMore: (directory: string) => void
  loading?: boolean
  error?: string
  onRetry?: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/")
}

function pathName(p: string) {
  return normalizePath(p).split("/").filter(Boolean).pop() ?? p
}

function buildProjectNodes(
  projectCounts: Array<{ project_id: string; count: number; worktree: string | null; name: string | null }>,
  query: string,
): TreeNode[] {
  // Aggregate by normalized worktree (multiple project IDs can share a worktree)
  const worktreeMap = new Map<string, { worktree: string; name: string | null; count: number }>()
  for (const pc of projectCounts) {
    if (!pc.worktree) continue
    const key = normalizePath(pc.worktree).toLowerCase()
    const existing = worktreeMap.get(key)
    if (existing) {
      existing.count += pc.count
    } else {
      worktreeMap.set(key, { worktree: pc.worktree, name: pc.name, count: pc.count })
    }
  }
  return [...worktreeMap.values()]
    .filter((entry) => entry.count > 0)
    .map((entry) => {
      const name = entry.name || pathName(entry.worktree)
      return { name, fullPath: normalizePath(entry.worktree), count: entry.count, ownCount: entry.count, isLeaf: true, children: [] as TreeNode[] }
    })
    .filter((node) => !query || node.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildTree(directories: Array<{ directory: string; count: number }>): TreeNode[] {
  if (directories.length === 0) return []

  type TrieNode = {
    segment: string
    fullPath: string
    children: Map<string, TrieNode>
    originalCount: number | null
  }

  const root = new Map<string, TrieNode>()

  for (const dir of directories) {
    const parts = dir.directory.replace(/\\/g, "/").split("/").filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!
      const pathSoFar = parts.slice(0, i + 1).join("/")

      if (!current.has(segment)) {
        current.set(segment, {
          segment,
          fullPath: pathSoFar,
          children: new Map(),
          originalCount: null,
        })
      }

      if (i === parts.length - 1) {
        current.get(segment)!.originalCount = dir.count
      }

      current = current.get(segment)!.children
    }
  }

  function toTreeNode(trie: TrieNode): TreeNode {
    const children: TreeNode[] = []
    for (const child of trie.children.values()) {
      children.push(toTreeNode(child))
    }
    const isLeaf = trie.children.size === 0
    const ownCount = trie.originalCount ?? 0
    const childSum = children.reduce((sum, c) => sum + c.count, 0)
    const count = ownCount + childSum
    return { name: trie.segment, fullPath: trie.fullPath, count, ownCount, isLeaf, children }
  }

  function collapse(node: TreeNode): TreeNode {
    const children = node.children.map(collapse)
    if (children.length === 1 && !node.isLeaf) {
      const child = children[0]!
      return {
        name: node.name + "/" + child.name,
        fullPath: child.isLeaf ? child.fullPath : node.fullPath + "/" + child.name,
        count: node.ownCount + child.count,
        ownCount: node.ownCount + child.ownCount,
        isLeaf: child.isLeaf,
        children: child.children,
      }
    }
    return { ...node, children }
  }

  return [...root.values()].map((trie) => {
    const processed = toTreeNode(trie)
    return { ...processed, children: processed.children.map(collapse) }
  })
}

const viewModes: { key: ViewMode; label: string }[] = [
  { key: "directories", label: "Directory Tree" },
  { key: "projects", label: "Projects" },
]

export function SessionBrowserPanel(props: PanelProps) {
  const query = createMemo(() => props.searchQuery.toLowerCase().trim())

  const filteredDirectories = createMemo(() => {
    const q = query()
    if (!q) return props.directories
    return props.directories.filter((d) => d.directory.toLowerCase().includes(q))
  })

  const tree = createMemo(() => {
    if (props.viewMode === "projects") {
      return buildProjectNodes(props.projectCounts, query())
    }
    return buildTree(filteredDirectories())
  })

  const emptyLabel = createMemo(() => {
    if (query()) return "No matches"
    if (props.viewMode === "projects") return "No projects with sessions"
    return "No directories found"
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-background-base">
      <div class="flex shrink-0 flex-col gap-1.5 border-b border-border-base px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="text-14-semibold text-text-standard">Session History</span>
          <input
            type="text"
            placeholder="Filter..."
            value={props.searchQuery}
            onInput={(e) => props.onSearchChange(e.currentTarget.value)}
            class="h-6 min-w-0 flex-1 rounded bg-surface-raised-base px-2 text-12-regular text-text-standard placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-border-interactive-base"
          />
        </div>
        <div class="flex gap-0.5 rounded-md bg-surface-raised-base p-0.5">
          <For each={viewModes}>
            {(mode) => (
              <button
                class="flex-1 rounded px-1.5 py-0.5 text-12-medium transition-colors"
                classList={{
                  "bg-background-base text-text-strong shadow-xs": props.viewMode === mode.key,
                  "text-text-weak hover:text-text-base": props.viewMode !== mode.key,
                }}
                onClick={() => props.onViewModeChange(mode.key)}
              >
                {mode.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={!props.loading || props.directories.length > 0}
          fallback={
            <div class="flex items-center justify-center py-8 text-text-weak">
              <Spinner class="size-5" />
            </div>
          }
        >
          <Show
            when={!props.error}
            fallback={
              <div class="flex flex-col items-center gap-2 py-8 text-text-weak">
                <span class="text-13-regular">{props.error}</span>
                {props.onRetry && (
                  <button
                    class="text-13-medium text-text-interactive-base hover:underline"
                    onClick={props.onRetry}
                  >
                    Retry
                  </button>
                )}
              </div>
            }
          >
            <Show
              when={tree().length > 0}
              fallback={
                <div class="py-8 text-center text-13-regular text-text-weak">
                  {emptyLabel()}
                </div>
              }
            >
              <For each={tree()}>
                {(node) => (
                  <DirectoryNode
                    node={node}
                    depth={0}
                    sessionsByDir={props.sessionsByDir}
                    metaByDir={props.metaByDir}
                    expandedDirs={props.expandedDirs}
                    sessionsVisible={props.sessionsVisible}
                    onToggleDir={props.onToggleDir}
                    onToggleSessions={props.onToggleSessions}
                    onSelectSession={props.onSelectSession}
                    onLoadMore={props.onLoadMore}
                    currentSessionId={props.currentSessionId}
                  />
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
