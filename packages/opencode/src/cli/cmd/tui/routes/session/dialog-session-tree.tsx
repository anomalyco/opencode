import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, onMount, type JSX } from "solid-js"
import { Locale } from "@/util/locale"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import type { Session } from "@opencode-ai/sdk/v2"
import "opentui-spinner/solid"

interface TreeOption {
  title: string
  value: string
  prefix: string
  footer: string
  gutter: JSX.Element | undefined
}

/**
 * Find the root session by walking up the parentID chain
 */
function findRootSession(
  currentSession: Session | undefined,
  getSession: (id: string) => Session | undefined,
): Session | undefined {
  let current = currentSession
  while (current?.parentID) {
    current = getSession(current.parentID)
  }
  return current
}

/**
 * Extract agent name from session title or agent field
 * Session titles often contain "@agent-name" pattern
 */
function extractAgentName(session: Session): string {
  // Try to extract from title pattern "... (@agent-name ...)"
  const match = session.title?.match(/@([^\s)]+)/)
  if (match) return match[1]

  // Fallback to first meaningful word of title, or "Session"
  const firstWord = session.title?.split(" ")[0]
  if (firstWord && firstWord.length > 0 && firstWord.length < 30) {
    return firstWord
  }
  return "Session"
}

/**
 * Build flat array of tree options with visual prefixes using DFS traversal
 */
function buildTreeOptions(
  sessions: Session[],
  currentSessionId: string,
  rootSession: Session | undefined,
  sync: ReturnType<typeof useSync>,
  theme: any,
  animationsEnabled: boolean,
): TreeOption[] {
  if (!rootSession) return []

  const result: TreeOption[] = []
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  function getStatusIndicator(session: Session) {
    // Current session indicator
    if (session.id === currentSessionId) {
      return <text fg={theme.primary}>●</text>
    }

    // Permission awaiting indicator
    const permission = sync.data.permission[session.id]
    if (permission?.length) {
      return <text fg={theme.warning}>◉</text>
    }

    // Busy session indicator (spinner)
    const status = sync.data.session_status?.[session.id]
    if (status?.type === "busy") {
      if (animationsEnabled) {
        return <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
      }
      return <text fg={theme.textMuted}>[⋯]</text>
    }

    return undefined
  }

  function traverse(session: Session, depth: number, prefix: string, isLast: boolean) {
    // Determine connector for this node
    const connector = depth === 0 ? "" : isLast ? "└─ " : "├─ "
    // Determine prefix for children (continuation line or space)
    const childPrefix = prefix + (depth === 0 ? "" : isLast ? "   " : "│  ")

    const agentName = extractAgentName(session)
    // For root, show full title; for children, show agent + truncated title
    const displayTitle =
      depth === 0 ? session.title || "Session" : `${agentName} "${session.title || ""}"`

    result.push({
      title: displayTitle,
      value: session.id,
      prefix: prefix + connector,
      footer: Locale.time(session.time.updated),
      gutter: getStatusIndicator(session),
    })

    // Get direct children and sort by id for consistent ordering
    const children = sessions
      .filter((s) => s.parentID === session.id)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    children.forEach((child, i) => {
      traverse(child, depth + 1, childPrefix, i === children.length - 1)
    })
  }

  traverse(rootSession, 0, "", true)
  return result
}

export function DialogSessionTree() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const kv = useKV()

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const session = createMemo(() => {
    const id = currentSessionID()
    return id ? sync.session.get(id) : undefined
  })

  const rootSession = createMemo(() => {
    return findRootSession(session(), (id) => sync.session.get(id))
  })

  const animationsEnabled = kv.get("animations_enabled", true)

  const options = createMemo(() => {
    const root = rootSession()
    const currentId = currentSessionID()
    if (!root || !currentId) return []

    const treeOptions = buildTreeOptions(
      sync.data.session,
      currentId,
      root,
      sync,
      theme,
      animationsEnabled,
    )

    // Convert to DialogSelectOption format with custom rendering
    return treeOptions.map((opt) => ({
      title: opt.prefix + opt.title,
      value: opt.value,
      footer: opt.footer,
      gutter: opt.gutter,
    }))
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Session Tree"
      options={options()}
      current={currentSessionID()}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
    />
  )
}
