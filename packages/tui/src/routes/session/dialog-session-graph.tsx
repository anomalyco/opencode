import { createMemo, createSignal, For, Show } from "solid-js"
import { useRoute } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { isThread, isSubagent, getSelectedText, getThreadChildren, getSubagentChildren } from "../../util/session"
import type { Session } from "@opencode-ai/sdk/v2"

interface TreeNode {
  session: Session
  isCurrent: boolean
  threads: TreeNode[]
  subagents: TreeNode[]
  depth: number
}

export function DialogSessionGraph() {
  const routeData = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const sessions = createMemo(() => sync.data.session)
  const currentSessionID = createMemo(() =>
    routeData.data.type === "session" ? routeData.data.sessionID : undefined
  )

  const currentSession = createMemo(() => {
    const id = currentSessionID()
    if (!id) return null
    return sessions().find((s) => s.id === id) ?? null
  })

  const ancestors = createMemo((): Session[] => {
    const id = currentSessionID()
    if (!id) return []
    const session = sessions().find((s) => s.id === id)
    if (!session) return []
    const result: Session[] = []
    let current = session
    while (current.parentID) {
      const parent = sessions().find((s) => s.id === current!.parentID)
      if (!parent) break
      if (isThread(parent)) {
        result.unshift(parent)
      }
      current = parent
    }
    return result
  })

  const tree = createMemo((): TreeNode[] => {
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

    // Build tree recursively for threads and subagents
    const buildTree = (parentID: string, depth: number): TreeNode[] => {
      const threads = getThreadChildren(parentID, allSessions).map((s) => ({
        session: s,
        isCurrent: s.id === id,
        threads: buildTree(s.id, depth + 1),
        subagents: getSubagentChildren(s.id, allSessions).map((sa) => ({
          session: sa,
          isCurrent: sa.id === id,
          threads: [],
          subagents: [],
          depth: depth + 1,
        })),
        depth,
      }))

      return threads
    }

    const rootNode = allSessions.find((s) => s.id === rootID)
    if (!rootNode) return []

    // Build root node
    const rootChildren = buildTree(rootID, 0)
    const rootSubagents = getSubagentChildren(rootID, allSessions).map((sa) => ({
      session: sa,
      isCurrent: sa.id === id,
      threads: [],
      subagents: [],
      depth: 0,
    }))

    return [
      {
        session: rootNode,
        isCurrent: rootID === id,
        threads: rootChildren,
        subagents: rootSubagents,
        depth: 0,
      },
    ]
  })

  const handleSelect = (sessionID: string) => {
    routeData.navigate({ type: "session", sessionID })
    dialog.clear()
  }

  const renderNode = (node: TreeNode, indent: number = 0) => {
    const isSelectedText = getSelectedText(node.session)
    const isSubagentNode = isSubagent(node.session)

    return (
      <box flexDirection="column">
        <box
          paddingLeft={2 + indent * 2}
          paddingRight={2}
          paddingTop={0.3}
          paddingBottom={0.3}
          onMouseUp={() => handleSelect(node.session.id)}
        >
          <text>
            <Show when={node.isCurrent}>
              <span style={{ fg: theme.primary }}>▸ </span>
            </Show>
            <Show when={!node.isCurrent && isSubagentNode}>
              <span style={{ fg: theme.warning }}>◆ </span>
            </Show>
            <Show when={!node.isCurrent && !isSubagentNode}>
              <span style={{ fg: theme.textMuted }}>  </span>
            </Show>
            <span
              style={{
                fg: node.isCurrent ? theme.primary : isSubagentNode ? theme.warning : theme.text,
                bold: node.isCurrent,
              }}
            >
              {node.session.title}
            </span>
          </text>
        </box>
        <Show when={isSelectedText}>
          <box paddingLeft={4 + indent * 2} paddingRight={2}>
            <text fg={theme.textMuted} wrapMode="word">
              "{isSelectedText!.slice(0, 60)}
              {isSelectedText!.length > 60 ? "..." : ""}"
            </text>
          </box>
        </Show>
        <For each={node.threads}>{(child) => renderNode(child, indent + 1)}</For>
        <For each={node.subagents}>{(child) => renderNode(child, indent + 1)}</For>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width={65}
      height={25}
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
          <b>Session Graph</b>
          <Show when={currentSession()}>
            <span style={{ fg: theme.textMuted }}> — {currentSession()!.title}</span>
          </Show>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} paddingTop={1} overflow="hidden">
        <Show when={ancestors().length > 0}>
          <For each={ancestors()}>
            {(ancestor) => (
              <box
                paddingLeft={2}
                paddingRight={2}
                paddingTop={0.3}
                paddingBottom={0.3}
                onMouseUp={() => handleSelect(ancestor.id)}
              >
                <text>
                  <span style={{ fg: theme.textMuted }}>↑ {ancestor.title}</span>
                </text>
                <Show when={getSelectedText(ancestor)}>
                  <box paddingLeft={4} paddingRight={2}>
                    <text fg={theme.textMuted} wrapMode="word">
                      "{getSelectedText(ancestor)!.slice(0, 50)}
                      {getSelectedText(ancestor)!.length > 50 ? "..." : ""}"
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

        <For each={tree()}>{(node) => renderNode(node)}</For>

        <Show
          when={tree().length === 0}
        >
          <box paddingLeft={2} paddingTop={0.5}>
            <text fg={theme.textMuted}>No threads or subagents. Use /thread to create one.</text>
          </box>
        </Show>
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} border={["top"]} borderColor={theme.border}>
        <text fg={theme.textMuted}>Click to navigate · Esc to close</text>
      </box>
    </box>
  )
}
