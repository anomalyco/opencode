import { For, Show, createSignal, onCleanup } from "solid-js"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { SessionNode } from "./session-node"
import type { Session } from "@opencode-ai/sdk/v2/client"

export type TreeNode = {
  name: string
  fullPath: string
  count: number
  ownCount: number
  isLeaf: boolean
  children: TreeNode[]
}

export type DirectoryNodeProps = {
  node: TreeNode
  depth: number
  sessionsByDir: Record<string, Session[]>
  metaByDir: Record<string, { loading: boolean; cursor?: number; complete: boolean }>
  expandedDirs: Record<string, boolean>
  sessionsVisible: Record<string, boolean>
  onToggleDir: (directory: string) => void
  onToggleSessions: (directory: string) => void
  onSelectSession: (directory: string, sessionId: string) => void
  onLoadMore: (directory: string) => void
  currentSessionId?: string
}

function useSentinel(onVisible: () => void) {
  return (el: HTMLDivElement) => {
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible()
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }
}

export function DirectoryNode(props: DirectoryNodeProps) {
  const [treeExpanded, setTreeExpanded] = createSignal(false)

  const isOpen = () =>
    props.node.isLeaf
      ? (props.expandedDirs[props.node.fullPath] ?? false)
      : treeExpanded()

  const toggle = () => {
    if (props.node.isLeaf) {
      props.onToggleDir(props.node.fullPath)
    } else {
      setTreeExpanded((prev) => !prev)
    }
  }

  const sessionsShown = () => props.sessionsVisible[props.node.fullPath] ?? false
  const sessions = () => props.sessionsByDir[props.node.fullPath] ?? []
  const meta = () => props.metaByDir[props.node.fullPath]
  const loading = () => meta()?.loading ?? false
  const hasMore = () => !(meta()?.complete ?? true)

  const indent = () => props.depth * 12 + 8

  return (
    <Collapsible variant="ghost" open={isOpen()} onOpenChange={toggle}>
      <Collapsible.Trigger
        class="group flex w-full items-center gap-1.5 rounded py-1.5 pr-2 text-left hover:bg-surface-raised-base-hover/50"
        style={{ "padding-left": `${indent()}px` }}
      >
        <span class="shrink-0 text-text-weak">
          <Icon name="folder" size="small" />
        </span>
        <span
          class="min-w-0 flex-1 truncate text-13-regular text-text-standard"
          title={props.node.fullPath}
        >
          {props.node.name}
        </span>
        <span class="shrink-0 text-12-regular text-text-weak">{props.node.count}</span>
        <Show when={loading()}>
          <span class="shrink-0 text-text-weak">
            <Spinner class="size-3" />
          </span>
        </Show>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div
          class="flex items-center gap-1 py-0.5"
          style={{ "padding-left": `${indent() + 12}px` }}
        >
          <button
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-11-medium text-text-weak hover:bg-surface-raised-base-hover/50 hover:text-text-base"
            onClick={(e) => {
              e.stopPropagation()
              props.onToggleSessions(props.node.fullPath)
            }}
          >
            <Icon name={sessionsShown() ? "chevron-down" : "chevron-right"} size="small" />
            <span>{sessionsShown() ? "Hide sessions" : `Show sessions (${props.node.ownCount})`}</span>
            <Show when={loading()}>
              <Spinner class="size-3" />
            </Show>
          </button>
        </div>
        <Show when={sessionsShown()}>
          <Show when={sessions().length > 0 || loading()}>
            <div style={{ "padding-left": `${indent() + 12}px` }}>
              <For each={sessions()}>
                {(session) => (
                  <SessionNode
                    session={session}
                    active={session.id === props.currentSessionId}
                    onClick={() => props.onSelectSession(session.directory, session.id)}
                  />
                )}
              </For>
              <Show when={hasMore()}>
                <div
                  ref={useSentinel(() => {
                    if (!loading()) props.onLoadMore(props.node.fullPath)
                  })}
                  class="h-4"
                />
              </Show>
            </div>
          </Show>
          <Show when={sessions().length === 0 && !loading()}>
            <div
              class="px-2 py-2 text-12-regular text-text-weak"
              style={{ "padding-left": `${indent() + 20}px` }}
            >
              No sessions
            </div>
          </Show>
        </Show>
        <For each={props.node.children}>
          {(child) => (
            <DirectoryNode
              node={child}
              depth={props.depth + 1}
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
      </Collapsible.Content>
    </Collapsible>
  )
}
