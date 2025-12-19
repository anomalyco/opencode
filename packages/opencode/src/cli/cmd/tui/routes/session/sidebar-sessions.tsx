import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { useRoute } from "@tui/context/route"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useKeyboard } from "@opentui/solid"
import { useCommandDialog } from "@tui/component/dialog-command"
import { Locale } from "@/util/locale"
import type { Session, AssistantMessage } from "@opencode-ai/sdk/v2"

interface FlatNode {
  session: Session
  depth: number
  hasChildren: boolean
}

function getContextCircle(percentage: number): { char: string; colorKey: "error" | "warning" | "info" | "success" } {
  if (percentage >= 90) return { char: "●", colorKey: "error" }
  if (percentage >= 60) return { char: "◕", colorKey: "warning" }
  if (percentage >= 40) return { char: "◐", colorKey: "info" }
  if (percentage >= 10) return { char: "◔", colorKey: "success" }
  return { char: "○", colorKey: "success" }
}

export function SessionsSidebar(props: { onClose: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const command = useCommandDialog()

  // Suspend global keybinds while sidebar is open
  command.keybinds(false)
  onCleanup(() => command.keybinds(true))

  const [cursor, setCursor] = createSignal(0)
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [showHelp, setShowHelp] = createSignal(false)

  const currentSessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)

  // Group sessions by parent
  const sessionsByParent = createMemo(() => {
    const byParent = new Map<string | undefined, Session[]>()
    for (const session of sync.data.session) {
      const parentId = session.parentID
      if (!byParent.has(parentId)) byParent.set(parentId, [])
      byParent.get(parentId)!.push(session)
    }
    for (const [, children] of byParent) {
      children.sort((a, b) => b.time.updated - a.time.updated)
    }
    return byParent
  })

  // Build flat list for keyboard navigation
  const flatList = createMemo(() => {
    const result: FlatNode[] = []
    const byParent = sessionsByParent()

    function addNodes(parentId: string | undefined, depth: number) {
      const children = byParent.get(parentId) ?? []
      for (const session of children) {
        const hasChildren = (byParent.get(session.id)?.length ?? 0) > 0
        result.push({ session, depth, hasChildren })
        if (expanded[session.id] && hasChildren) {
          addNodes(session.id, depth + 1)
        }
      }
    }
    addNodes(undefined, 0)
    return result
  })

  const currentNode = () => flatList()[cursor()]

  function getContextPercentage(sessionId: string): number {
    const messages = sync.data.message[sessionId] ?? []
    const lastAssistant = messages.findLast((x) => x.role === "assistant" && x.tokens.output > 0) as
      | AssistantMessage
      | undefined
    if (!lastAssistant) return 0
    const total =
      lastAssistant.tokens.input +
      lastAssistant.tokens.output +
      lastAssistant.tokens.reasoning +
      lastAssistant.tokens.cache.read +
      lastAssistant.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === lastAssistant.providerID)?.models[lastAssistant.modelID]
    if (!model?.limit.context) return 0
    return Math.round((total / model.limit.context) * 100)
  }

  function toggleExpand(sessionId: string) {
    setExpanded(sessionId, !expanded[sessionId])
  }

  function expandAll(sessionId: string) {
    const byParent = sessionsByParent()
    function expand(id: string) {
      const children = byParent.get(id) ?? []
      if (children.length > 0) {
        setExpanded(id, true)
        children.forEach((c) => expand(c.id))
      }
    }
    expand(sessionId)
  }

  function collapseAll() {
    for (const key of Object.keys(expanded)) {
      setExpanded(key, false)
    }
  }

  function openSession(sessionId: string) {
    route.navigate({ type: "session", sessionID: sessionId })
  }

  async function deleteSession(sessionId: string) {
    const confirmed = await DialogConfirm.show(dialog, "Delete Session", "Are you sure you want to delete this session?")
    if (confirmed) sdk.client.session.delete({ sessionID: sessionId })
  }

  async function renameSession(session: Session) {
    const newTitle = await DialogPrompt.show(dialog, "Rename Session", { value: session.title, placeholder: "Enter new name" })
    if (newTitle && newTitle !== session.title) {
      sdk.client.session.update({ sessionID: session.id, title: newTitle })
    }
  }

  function findParentIndex(idx: number): number {
    const list = flatList()
    const node = list[idx]
    if (!node || node.depth === 0) return idx
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].depth < node.depth) return i
    }
    return idx
  }

  // Keyboard navigation
  useKeyboard((evt) => {
    const list = flatList()
    const node = currentNode()

    if (showHelp()) {
      setShowHelp(false)
      evt.preventDefault()
      return
    }

    switch (evt.name) {
      case "j":
      case "down":
        setCursor((i) => Math.min(i + 1, list.length - 1))
        evt.preventDefault()
        break
      case "k":
      case "up":
        setCursor((i) => Math.max(i - 1, 0))
        evt.preventDefault()
        break
      case "g":
        setCursor(0)
        evt.preventDefault()
        break
      case "G":
        setCursor(list.length - 1)
        evt.preventDefault()
        break
      case "return":
        if (node) {
          openSession(node.session.id)
          props.onClose()
        }
        evt.preventDefault()
        break
      case "o":
        if (node) {
          if (node.hasChildren) {
            toggleExpand(node.session.id)
          } else {
            openSession(node.session.id)
            props.onClose()
          }
        }
        evt.preventDefault()
        break
      case "O":
        if (node) expandAll(node.session.id)
        evt.preventDefault()
        break
      case "x":
        if (node) {
          const parentIdx = findParentIndex(cursor())
          const parent = list[parentIdx]
          if (parent && parent.session.id !== node.session.id) {
            setExpanded(parent.session.id, false)
            setCursor(parentIdx)
          }
        }
        evt.preventDefault()
        break
      case "X":
        collapseAll()
        evt.preventDefault()
        break
      case "p":
        setCursor(findParentIndex(cursor()))
        evt.preventDefault()
        break
      case "d":
        if (node) deleteSession(node.session.id)
        evt.preventDefault()
        break
      case "r":
        if (node) renameSession(node.session)
        evt.preventDefault()
        break
      case "n":
        route.navigate({ type: "home" })
        props.onClose()
        evt.preventDefault()
        break
      case "q":
      case "escape":
        props.onClose()
        evt.preventDefault()
        break
      case "?":
        setShowHelp((v) => !v)
        evt.preventDefault()
        break
    }
  })

  // Set cursor to current session on mount
  onMount(() => {
    const sessionID = currentSessionID()
    if (!sessionID) return

    // Expand parents to show current session
    const byParent = sessionsByParent()
    let session = sync.data.session.find((s) => s.id === sessionID)
    while (session?.parentID) {
      setExpanded(session.parentID, true)
      session = sync.data.session.find((s) => s.id === session!.parentID)
    }

    // Find and set cursor position
    setTimeout(() => {
      const idx = flatList().findIndex((n) => n.session.id === sessionID)
      if (idx >= 0) setCursor(idx)
    }, 0)
  })

  return (
    <box
      width={35}
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      border={["right"]}
      borderColor={theme.border}
    >
      <Show
        when={!showHelp()}
        fallback={
          <box>
            <text fg={theme.text}>
              <b>Navigation</b>
            </text>
            <text fg={theme.textMuted}>─────────────────────────────</text>
            <text fg={theme.text}>
              j/k, ↑/↓ <span style={{ fg: theme.textMuted }}>Move cursor</span>
            </text>
            <text fg={theme.text}>
              Enter, o <span style={{ fg: theme.textMuted }}>Open / Toggle</span>
            </text>
            <text fg={theme.text}>
              O <span style={{ fg: theme.textMuted }}>Expand all</span>
            </text>
            <text fg={theme.text}>
              x <span style={{ fg: theme.textMuted }}>Collapse parent</span>
            </text>
            <text fg={theme.text}>
              X <span style={{ fg: theme.textMuted }}>Collapse all</span>
            </text>
            <text fg={theme.text}>
              p <span style={{ fg: theme.textMuted }}>Go to parent</span>
            </text>
            <text fg={theme.text}>
              g/G <span style={{ fg: theme.textMuted }}>Top/Bottom</span>
            </text>
            <text fg={theme.textMuted}>─────────────────────────────</text>
            <text fg={theme.text}>
              n <span style={{ fg: theme.textMuted }}>New session</span>
            </text>
            <text fg={theme.text}>
              r <span style={{ fg: theme.textMuted }}>Rename</span>
            </text>
            <text fg={theme.text}>
              d <span style={{ fg: theme.textMuted }}>Delete</span>
            </text>
            <text fg={theme.textMuted}>─────────────────────────────</text>
            <text fg={theme.text}>
              q, Esc <span style={{ fg: theme.textMuted }}>Close sidebar</span>
            </text>
            <text fg={theme.textMuted} marginTop={1}>
              Press any key to close
            </text>
          </box>
        }
      >
        <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <text fg={theme.text}>
            <b>SESSIONS</b>
          </text>
          <text fg={theme.textMuted}>?=help</text>
        </box>
        <scrollbox flexGrow={1}>
          <For each={flatList()}>
            {(node, index) => {
              const isActive = () => currentSessionID() === node.session.id
              const isCursor = () => cursor() === index()
              const status = () => sync.data.session_status?.[node.session.id]
              const isBusy = () => status()?.type === "busy"
              const contextInfo = () => getContextCircle(getContextPercentage(node.session.id))
              const relTime = () => Locale.relativeTime(node.session.time.updated)

              const indent = "  ".repeat(node.depth)
              const expandChar = node.hasChildren ? (expanded[node.session.id] ? "▼" : "▶") : " "

              return (
                <box
                  backgroundColor={isCursor() ? theme.backgroundElement : undefined}
                  onMouseDown={() => {
                    setCursor(index())
                    if (node.hasChildren) {
                      toggleExpand(node.session.id)
                    } else {
                      openSession(node.session.id)
                      props.onClose()
                    }
                  }}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>
                      {indent}
                      {expandChar}
                    </text>
                    <text fg={isActive() ? theme.primary : theme.text} flexGrow={1}>
                      {Locale.truncate(node.session.title, 18)}
                    </text>
                    <text fg={theme.textMuted}>{relTime().padStart(3)}</text>
                    <text fg={isBusy() ? theme.success : theme.textMuted}>{isBusy() ? "●" : "○"}</text>
                    <text fg={theme[contextInfo().colorKey]}>{contextInfo().char}</text>
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}
