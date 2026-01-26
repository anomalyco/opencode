import { createMemo, createSignal, createEffect, For, Show, on } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useKV } from "@tui/context/kv"
import { Locale } from "@/util/locale"
import type { Session, Workspace } from "@forge/sdk"

interface WorkspaceSidebarProps {
  currentSessionID?: string
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const kv = useKV()

  // Get sessions grouped by workspace
  const sessionsByWorkspace = createMemo(() => sync.workspace.sessionsByWorkspace())

  // Find which workspace contains the current session
  const currentSessionWorkspaceID = createMemo(() => {
    if (!props.currentSessionID) return null
    const session = sync.data.session.find((s) => s.id === props.currentSessionID)
    return session?.workspaceID ?? null
  })

  // Get expanded state from KV store
  // Default: expand the workspace with the current session, or main if no current session
  const [expandedWorkspaces, setExpandedWorkspaces] = createSignal<Set<string | null>>(
    new Set(kv.get("workspace_sidebar_expanded", [currentSessionWorkspaceID()]) as (string | null)[]),
  )

  // Auto-expand when current session changes to a different workspace
  createEffect(
    on(currentSessionWorkspaceID, (wsID) => {
      if (wsID !== undefined) {
        setExpandedWorkspaces((prev) => {
          const next = new Set(prev)
          next.add(wsID)
          kv.set("workspace_sidebar_expanded", Array.from(next))
          return next
        })
      }
    }),
  )

  const toggleExpanded = (workspaceID: string | null) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceID)) {
        next.delete(workspaceID)
      } else {
        next.add(workspaceID)
      }
      // Persist to KV
      kv.set("workspace_sidebar_expanded", Array.from(next))
      return next
    })
  }

  const isExpanded = (workspaceID: string | null) => expandedWorkspaces().has(workspaceID)

  // Get main worktree info - use mainBranch from project info (not current branch)
  const mainBranch = createMemo(() => sync.data.project?.mainBranch ?? sync.data.project?.branch ?? "main")
  const mainSessions = createMemo(() => {
    const sessions = sessionsByWorkspace().get(null) ?? []
    return sessions.toSorted((a, b) => b.time.updated - a.time.updated)
  })

  // Check if main worktree is the current workspace (current session has no workspaceID)
  const isMainWorktreeCurrent = createMemo(() => currentSessionWorkspaceID() === null)

  // Get workspaces sorted by last accessed
  const sortedWorkspaces = createMemo(() => {
    return sync.data.workspace.toSorted((a, b) => b.time.accessed - a.time.accessed)
  })

  const navigateToSession = (sessionID: string) => {
    navigate({ type: "session", sessionID })
  }

  return (
    <scrollbox width={30} paddingRight={1}>
      <box flexShrink={0} gap={1}>
        {/* Main worktree always at top */}
        <WorkspaceSection
          name={mainBranch()}
          isMain={true}
          isCurrent={isMainWorktreeCurrent()}
          sessions={mainSessions()}
          isExpanded={isExpanded(null)}
          onToggle={() => toggleExpanded(null)}
          onSelectSession={navigateToSession}
          currentSessionID={props.currentSessionID}
        />

        {/* User-created workspaces sorted by access time */}
        <For each={sortedWorkspaces()}>
          {(workspace) => {
            const sessions = createMemo(() => {
              const list = sessionsByWorkspace().get(workspace.id) ?? []
              return list.toSorted((a, b) => b.time.updated - a.time.updated)
            })
            const isCurrent = createMemo(() => currentSessionWorkspaceID() === workspace.id)

            return (
              <WorkspaceSection
                name={workspace.name}
                isMain={false}
                isCurrent={isCurrent()}
                workspace={workspace}
                sessions={sessions()}
                isExpanded={isExpanded(workspace.id)}
                onToggle={() => toggleExpanded(workspace.id)}
                onSelectSession={navigateToSession}
                currentSessionID={props.currentSessionID}
              />
            )
          }}
        </For>
      </box>
    </scrollbox>
  )
}

interface WorkspaceSectionProps {
  name: string
  isMain: boolean
  isCurrent: boolean
  workspace?: Workspace
  sessions: Session[]
  isExpanded: boolean
  onToggle: () => void
  onSelectSession: (sessionID: string) => void
  currentSessionID?: string
}

function WorkspaceSection(props: WorkspaceSectionProps) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)

  const sessionCount = createMemo(() => props.sessions.length)

  return (
    <box>
      {/* Workspace header */}
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={props.onToggle}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        backgroundColor={hover() ? theme.backgroundElement : undefined}
      >
        <text fg={theme.text} flexShrink={0}>
          {props.isExpanded ? "\u25BC" : "\u25B6"}
        </text>
        <text fg={props.isCurrent ? theme.primary : theme.text} flexGrow={1}>
          <Show when={props.isCurrent}>
            <b>{props.name}</b>
          </Show>
          <Show when={!props.isCurrent}>{props.name}</Show>
          <Show when={props.isMain}>
            <span style={{ fg: theme.textMuted }}> (main)</span>
          </Show>
        </text>
        <text fg={theme.textMuted} flexShrink={0}>
          {sessionCount()}
        </text>
      </box>

      {/* Sessions list */}
      <Show when={props.isExpanded}>
        <Show
          when={sessionCount() > 0}
          fallback={
            <box paddingLeft={2}>
              <text fg={theme.textMuted}>
                <i>No sessions</i>
              </text>
            </box>
          }
        >
          <For each={props.sessions}>
            {(session) => (
              <SessionItem
                session={session}
                isCurrentSession={session.id === props.currentSessionID}
                onSelect={() => props.onSelectSession(session.id)}
              />
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}

interface SessionItemProps {
  session: Session
  isCurrentSession: boolean
  onSelect: () => void
}

function SessionItem(props: SessionItemProps) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)

  const title = createMemo(() => {
    // Truncate long titles
    const t = props.session.title
    if (t.length > 24) {
      return t.slice(0, 21) + "..."
    }
    return t
  })

  const timeAgo = createMemo(() => Locale.time(props.session.time.updated))

  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={2}
      onMouseDown={props.onSelect}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      backgroundColor={
        props.isCurrentSession ? theme.backgroundElement : hover() ? theme.backgroundPanel : undefined
      }
    >
      <text fg={props.isCurrentSession ? theme.primary : theme.textMuted} flexShrink={0}>
        {props.isCurrentSession ? "\u25CF" : "\u2022"}
      </text>
      <text fg={props.isCurrentSession ? theme.text : theme.textMuted} flexGrow={1}>
        {title()}
      </text>
    </box>
  )
}
