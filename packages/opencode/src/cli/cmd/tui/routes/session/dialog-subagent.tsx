import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useDialog } from "../../ui/dialog"
import { createMemo, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useTheme } from "@tui/context/theme"
import type { Session } from "@opencode-ai/sdk/v2"
import "opentui-spinner/solid"

interface SessionNode {
  session: Session
  depth: number
  categoryPath: string[]
}

const MAX_DEPTH = 3

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const currentSession = createMemo(() => sync.session.get(props.sessionID))

  // Get root parent session (walk up the tree)
  const rootParent = createMemo(() => {
    let current = currentSession()
    while (current?.parentID) {
      const parent = sync.session.get(current.parentID)
      if (!parent) break
      current = parent
    }
    return current
  })

  // Build session tree recursively up to MAX_DEPTH
  const buildTree = (parentId: string, depth: number, categoryPath: string[]): SessionNode[] => {
    if (depth >= MAX_DEPTH) return []

    const children = sync.data.session
      .filter((x) => x.parentID === parentId)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const result: SessionNode[] = []
    for (const child of children) {
      result.push({ session: child, depth, categoryPath })
      // Recurse into children
      const grandchildren = buildTree(child.id, depth + 1, [...categoryPath, child.title])
      result.push(...grandchildren)
    }
    return result
  }

  const sessionTree = createMemo(() => {
    const root = rootParent()
    if (!root) return []

    const result: SessionNode[] = []

    // Add root parent
    result.push({ session: root, depth: 0, categoryPath: [] })

    // Add all descendants
    const descendants = buildTree(root.id, 1, [])
    result.push(...descendants)

    return result
  })

  const spinnerFrames = [
    "\u280B",
    "\u2819",
    "\u2839",
    "\u2838",
    "\u283C",
    "\u2834",
    "\u2826",
    "\u2827",
    "\u2807",
    "\u280F",
  ]

  const getCategoryName = (node: SessionNode): string => {
    if (node.depth === 0) return "Parent"
    if (node.depth === 1) return "Subagents"
    // For deeper levels: "Subagents › parentTitle › grandparentTitle"
    return "Subagents › " + node.categoryPath.join(" › ")
  }

  const options = createMemo(() => {
    return sessionTree().map((node) => {
      const status = sync.data.session_status?.[node.session.id]
      const isWorking = status?.type === "busy"
      const hasPendingPermission = (sync.data.permission[node.session.id]?.length ?? 0) > 0

      return {
        title: node.session.title,
        value: node.session.id,
        category: getCategoryName(node),
        footer: Locale.time(node.session.time.updated),
        gutter: hasPendingPermission ? (
          <text fg={theme.warning}>◉</text>
        ) : isWorking ? (
          <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
        ) : undefined,
      }
    })
  })

  return (
    <DialogSelect
      title="Switch Session"
      current={props.sessionID}
      options={options()}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
    />
  )
}
