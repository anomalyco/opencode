import { createMemo, createSignal, For, Show } from "solid-js"
import { useRoute } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

interface ThreadNode {
  id: string
  title: string
  selectedText?: string
  isCurrent: boolean
  children: ThreadNode[]
  depth: number
}

export function DialogGraph() {
  const routeData = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const sessions = createMemo(() => sync.data.session)
  const currentSessionID = createMemo(() =>
    routeData.data.type === "session" ? routeData.data.sessionID : undefined
  )

  // Get current session
  const currentSession = createMemo(() => {
    const id = currentSessionID()
    if (!id) return null
    return sessions().find((s) => s.id === id) ?? null
  })

  // Build thread tree starting from the current session
  const threadTree = createMemo((): ThreadNode[] => {
    const id = currentSessionID()
    if (!id) return []

    const allSessions = sessions()

    // Find root: walk up parent chain from current session
    let rootID = id
    let current = allSessions.find((s) => s.id === id)
    while (current?.parentID) {
      rootID = current.parentID
      current = allSessions.find((s) => s.id === current!.parentID)
    }

    // Build tree recursively
    const buildTree = (parentID: string, depth: number): ThreadNode[] => {
      return allSessions
        .filter((s) => s.parentID === parentID && s.metadata?.type === "thread")
        .sort((a, b) => b.time.created - a.time.created)
        .map((s) => ({
          id: s.id,
          title: s.title,
          selectedText: s.metadata?.selectedText as string | undefined,
          isCurrent: s.id === id,
          children: buildTree(s.id, depth + 1),
          depth,
        }))
    }

    // Build from root
    const rootNode = allSessions.find((s) => s.id === rootID)
    const rootChildren = buildTree(rootID, 0)

    // If current session IS a thread, show it as root context
    if (rootNode && rootID !== id) {
      return [
        {
          id: rootNode.id,
          title: rootNode.title,
          isCurrent: false,
          children: rootChildren,
          depth: 0,
        },
      ]
    }

    return rootChildren
  })

  // Also find ancestors of current session
  const ancestors = createMemo((): ThreadNode[] => {
    const id = currentSessionID()
    if (!id) return []

    const allSessions = sessions()
    const result: ThreadNode[] = []
    let current = allSessions.find((s) => s.id === id)

    while (current?.parentID) {
      const parent = allSessions.find((s) => s.id === current!.parentID)
      if (parent && parent.metadata?.type === "thread") {
        result.unshift({
          id: parent.id,
          title: parent.title,
          selectedText: parent.metadata?.selectedText as string | undefined,
          isCurrent: false,
          children: [],
          depth: 0,
        })
      }
      current = parent
    }

    return result
  })

  const handleSelect = (sessionID: string) => {
    routeData.navigate({ type: "session", sessionID })
    dialog.clear()
  }

  const renderNode = (node: ThreadNode) => {
    return (
      <box flexDirection="column">
        <box
          paddingLeft={2 + node.depth * 2}
          paddingRight={2}
          paddingTop={0.3}
          paddingBottom={0.3}
          onMouseUp={() => handleSelect(node.id)}
        >
          <text>
            <Show when={node.isCurrent}>
              <span style={{ fg: theme.primary }}>▸ </span>
            </Show>
            <Show when={!node.isCurrent}>
              <span style={{ fg: theme.textMuted }}>  </span>
            </Show>
            <span
              style={{
                fg: node.isCurrent ? theme.primary : theme.text,
                bold: node.isCurrent,
              }}
            >
              {node.title}
            </span>
          </text>
        </box>
        <Show when={node.selectedText}>
          <box paddingLeft={4 + node.depth * 2} paddingRight={2}>
            <text fg={theme.textMuted} wrapMode="word">
              "{node.selectedText!.slice(0, 60)}
              {node.selectedText!.length > 60 ? "..." : ""}"
            </text>
          </box>
        </Show>
        <For each={node.children}>{(child) => renderNode(child)}</For>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width={65}
      height={20}
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.border}
      backgroundColor={theme.background}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        border={["bottom"]}
        borderColor={theme.border}
      >
        <text fg={theme.text}>
          <b>Thread Graph</b>
          <Show when={currentSession()}>
            <span style={{ fg: theme.textMuted }}> — {currentSession()!.title}</span>
          </Show>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} paddingTop={1} overflow="hidden">
        {/* Show ancestors (parent threads) */}
        <Show when={ancestors().length > 0}>
          <For each={ancestors()}>
            {(ancestor) => (
              <box paddingLeft={2 + ancestor.depth * 2} paddingRight={2} paddingTop={0.3} paddingBottom={0.3}>
                <text>
                  <span style={{ fg: theme.textMuted }}>↑ </span>
                  <span style={{ fg: theme.textMuted }}>{ancestor.title}</span>
                </text>
                <Show when={ancestor.selectedText}>
                  <box paddingLeft={4 + ancestor.depth * 2} paddingRight={2}>
                    <text fg={theme.textMuted} wrapMode="word">
                      "{ancestor.selectedText!.slice(0, 50)}
                      {ancestor.selectedText!.length > 50 ? "..." : ""}"
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </For>
          <box paddingLeft={2} paddingTop={0.3} paddingBottom={0.3}>
            <text fg={theme.textMuted}>│</text>
          </box>
        </Show>

        {/* Show current session */}
        <Show when={currentSession()}>
          <box paddingLeft={2} paddingRight={2} paddingTop={0.3} paddingBottom={0.3}>
            <text>
              <span style={{ fg: theme.primary }}>▸ </span>
              <span style={{ fg: theme.primary, bold: true }}>{currentSession()!.title}</span>
            </text>
          </box>
        </Show>

        {/* Show child threads */}
        <Show
          when={threadTree().length > 0}
          fallback={
            <box paddingLeft={2} paddingTop={0.5}>
              <text fg={theme.textMuted}>No child threads. Use /thread to create one.</text>
            </box>
          }
        >
          <For each={threadTree()}>{(node) => renderNode(node)}</For>
        </Show>
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} border={["top"]} borderColor={theme.border}>
        <text fg={theme.textMuted}>Click to navigate · Esc to close</text>
      </box>
    </box>
  )
}
