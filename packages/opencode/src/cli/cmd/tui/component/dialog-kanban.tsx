import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { DialogPrompt } from "../ui/dialog-prompt"
import { randomUUID } from "node:crypto"

type AccentKey = "primary" | "secondary" | "accent" | "warning" | "success" | "info" | "error"

type KanbanCard = {
  id: string
  title: string
  summary: string
  owner: string
  eta: string
  tags: string[]
  points: number
  risk: "low" | "medium" | "high"
  blocked?: boolean
}

type KanbanColumn = {
  id: string
  title: string
  subtitle: string
  accent: AccentKey
  focus: string
  wip: {
    current: number
    limit: number
  }
  cards: KanbanCard[]
}

type BoardState = {
  columns: KanbanColumn[]
  focus: {
    column: number
    card: number
  }
}

const LINK_ATTRS = TextAttributes.UNDERLINE

const BOARD_SEED: KanbanColumn[] = [
  {
    id: "ideas",
    title: "Backlog",
    subtitle: "Signals + research",
    accent: "info",
    focus: "Collect raw ideas",
    wip: { current: 3, limit: 6 },
    cards: [
      {
        id: "kb-sync",
        title: "Stream MCP events into Kanban",
        summary: "Mirror MCP sync events so ops can triage tool drift",
        owner: "Mia",
        eta: "Nov 14",
        tags: ["mcp", "sync"],
        points: 3,
        risk: "medium",
      },
      {
        id: "insight",
        title: "Insight heatmap",
        summary: "Overlay reasoning confidence onto prompts in history",
        owner: "Cal",
        eta: "Nov 18",
        tags: ["insight"],
        points: 5,
        risk: "high",
        blocked: true,
      },
      {
        id: "console-fold",
        title: "Console folding",
        summary: "Group identical log bursts in the HAL lens",
        owner: "Ash",
        eta: "Nov 20",
        tags: ["ui"],
        points: 2,
        risk: "low",
      },
    ],
  },
  {
    id: "doing",
    title: "In Flight",
    subtitle: "Active focus streams",
    accent: "warning",
    focus: "Protect cadence, unblock fast",
    wip: { current: 2, limit: 4 },
    cards: [
      {
        id: "kanban",
        title: "TUI Kanban dialog",
        summary: "Expose multi-column planning UI inside openTUI",
        owner: "You",
        eta: "Today",
        tags: ["tui", "ux"],
        points: 3,
        risk: "medium",
      },
      {
        id: "task-handoff",
        title: "Subagent handoff view",
        summary: "Visualize pending transfers + stuck assistants",
        owner: "Ara",
        eta: "Nov 16",
        tags: ["agents"],
        points: 4,
        risk: "medium",
      },
    ],
  },
  {
    id: "verify",
    title: "Review",
    subtitle: "QA + polish",
    accent: "accent",
    focus: "Guard rails + delight",
    wip: { current: 1, limit: 3 },
    cards: [
      {
        id: "palette",
        title: "Theme stress test",
        summary: "Review contrast + spacing for every built-in theme",
        owner: "Jess",
        eta: "Nov 15",
        tags: ["theme"],
        points: 2,
        risk: "low",
      },
    ],
  },
  {
    id: "done",
    title: "Shipped",
    subtitle: "Celebrations + learnings",
    accent: "success",
    focus: "Archive the work, capture lessons",
    wip: { current: 4, limit: 99 },
    cards: [
      {
        id: "drag",
        title: "Mouse drag select",
        summary: "Native region selection with OSC-52 copy",
        owner: "Team",
        eta: "Nov 10",
        tags: ["experience"],
        points: 2,
        risk: "low",
      },
      {
        id: "zen",
        title: "Zen install hints",
        summary: "Inline upgrade CTA in status dialog",
        owner: "Ops",
        eta: "Nov 09",
        tags: ["growth"],
        points: 1,
        risk: "low",
      },
      {
        id: "keybind",
        title: "Keybind overlay",
        summary: "Teach leader bindings with contextual overlay",
        owner: "Ray",
        eta: "Nov 11",
        tags: ["edu"],
        points: 2,
        risk: "medium",
      },
      {
        id: "trace",
        title: "Trace inspector",
        summary: "Scrollback aware reasoning inspector",
        owner: "Iris",
        eta: "Nov 12",
        tags: ["debug"],
        points: 3,
        risk: "medium",
      },
    ],
  },
]

export function DialogKanban() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const term = useTerminalDimensions()
  const [board, setBoard] = createStore<BoardState>({
    columns: BOARD_SEED.map((col) => ({
      ...col,
      cards: col.cards.map((card) => ({ ...card })),
      wip: {
        current: col.cards.length,
        limit: col.wip.limit,
      },
    })),
    focus: { column: 1, card: 0 },
  })

  const layoutBounds = {
    minWidth: 80,
    maxWidth: 200,
    minHeight: 18,
    maxHeight: 40,
    step: 2,
  }
  const [layout, setLayout] = createStore({ width: 130, height: 29 })
  let dragging = false,
    startX = 0,
    startY = 0,
    baseLeft = 0,
    baseTop = 0
  const applyFrame = (w: number, h: number, opts?: { preservePosition?: boolean }) => {
    const dims = term()
    const frameW = w + 4
    const frameH = h + 12
    const preserve = Boolean(opts?.preservePosition)
    let left = 0
    let top = 0
    if (preserve && (dialog as any).frame) {
      const f = (dialog as any).frame as { left?: number | null; top?: number | null }
      left = Math.max(0, Math.min(f.left ?? 0, Math.max(0, dims.width - frameW)))
      top = Math.max(1, Math.min(f.top ?? 1, Math.max(1, dims.height - frameH)))
    } else {
      left = Math.max(0, Math.floor((dims.width - frameW) / 2))
      top = Math.max(1, Math.floor((dims.height - frameH) / 3))
    }
    dialog.setFrame?.({ width: frameW, height: frameH, left, top })
  }
  const adjustWidth = (delta: number) => {
    const next = Math.min(layoutBounds.maxWidth, Math.max(layoutBounds.minWidth, layout.width + delta))
    setLayout("width", next)
    applyFrame(next, layout.height, { preservePosition: true })
  }
  const adjustHeight = (delta: number) => {
    const next = Math.min(layoutBounds.maxHeight, Math.max(layoutBounds.minHeight, layout.height + delta))
    setLayout("height", next)
    applyFrame(layout.width, next, { preservePosition: true })
  }

  const columnWidth = createMemo(() => {
    const columns = Math.max(1, board.columns.length)
    const gaps = Math.max(0, columns - 1) * 2
    const padding = 8
    const available = Math.max(layoutBounds.minWidth, layout.width - padding - gaps)
    return Math.max(18, Math.floor(available / columns))
  })

  const scrollHeight = createMemo(() => Math.max(8, layout.height - 11))

  const [compact, setCompact] = createSignal(true)

  onMount(() => {
    dialog.setSize("large")
    applyFrame(layout.width, layout.height)
  })

  const activeColumn = createMemo(() => board.columns[board.focus.column])
  const activeCard = createMemo(() => {
    const column = activeColumn()
    if (!column) return undefined
    if (column.cards.length === 0) return undefined
    if (board.focus.card < 0) return column.cards[0]
    return column.cards[board.focus.card]
  })

  const moveColumn = (delta: number) => {
    setBoard(
      produce((draft) => {
        if (draft.columns.length === 0) return
        const max = draft.columns.length
        const next = (draft.focus.column + delta + max) % max
        draft.focus.column = next
        const target = draft.columns[next]
        if (!target) return
        draft.focus.card = target.cards.length ? Math.min(Math.max(draft.focus.card, 0), target.cards.length - 1) : -1
      }),
    )
  }

  const moveCardSelection = (delta: number) => {
    setBoard(
      produce((draft) => {
        const column = draft.columns[draft.focus.column]
        if (!column) return
        if (!column.cards.length) {
          draft.focus.card = -1
          return
        }
        const next = draft.focus.card + delta
        if (next < 0) {
          draft.focus.card = 0
          return
        }
        if (next >= column.cards.length) {
          draft.focus.card = column.cards.length - 1
          return
        }
        draft.focus.card = next
      }),
    )
  }

  const shiftCard = (direction: number) => {
    setBoard(
      produce((draft) => {
        const fromColumn = draft.columns[draft.focus.column]
        if (!fromColumn) return
        if (!fromColumn.cards.length) return
        const targetIndex = draft.focus.column + direction
        if (targetIndex < 0) return
        if (targetIndex >= draft.columns.length) return
        const [card] = fromColumn.cards.splice(draft.focus.card, 1)
        if (!card) return
        const toColumn = draft.columns[targetIndex]
        toColumn.cards.unshift(card)
        fromColumn.wip.current = fromColumn.cards.length
        toColumn.wip.current = toColumn.cards.length
        draft.focus.column = targetIndex
        draft.focus.card = 0
      }),
    )
  }

  const createCard = async (targetColumnIndex?: number) => {
    const column =
      typeof targetColumnIndex === "number" ? board.columns[targetColumnIndex] : board.columns[board.focus.column]
    if (!column) return
    const value = await DialogPrompt.show(dialog, `New card for ${column.title}`)
    if (!value) return
    setBoard(
      produce((draft) => {
        const idx = typeof targetColumnIndex === "number" ? targetColumnIndex : draft.focus.column
        const target = draft.columns[idx]
        if (!target) return
        target.cards.unshift({
          id: randomUUID(),
          title: value,
          summary: "Outline next steps",
          owner: "You",
          eta: "Inbox",
          tags: ["new"],
          points: 1,
          risk: "low",
        })
        target.wip.current = target.cards.length
        draft.focus.column = idx
        draft.focus.card = 0
      }),
    )
  }

  useKeyboard(async (evt) => {
    if (evt.defaultPrevented) return
    if (evt.ctrl && evt.name === "left") {
      evt.preventDefault()
      shiftCard(-1)
      return
    }
    if (evt.ctrl && evt.name === "right") {
      evt.preventDefault()
      shiftCard(1)
      return
    }
    if (evt.name === "left" && !evt.ctrl) {
      evt.preventDefault()
      moveColumn(-1)
      return
    }
    if (evt.name === "right" && !evt.ctrl) {
      evt.preventDefault()
      moveColumn(1)
      return
    }
    if (evt.name === "up") {
      evt.preventDefault()
      moveCardSelection(-1)
      return
    }
    if (evt.name === "down") {
      evt.preventDefault()
      moveCardSelection(1)
      return
    }
    if ((evt.name === "a" || evt.name === "n") && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      await createCard()
      return
    }
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      setCompact((value) => !value)
    }
  })

  return (
    <box
      width={layout.width + 4}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      paddingTop={1}
      flexDirection="column"
      alignItems="center"
      gap={1}
      backgroundColor={theme.background}
    >
      <box width={layout.width} flexDirection="column" gap={1}>
        <box
          flexDirection="row"
          justifyContent="space-between"
          renderBefore={function () {
            const el = this as any
            el.on("mousedown", (e: any) => {
              dragging = true
              startX = e?.x ?? 0
              startY = e?.y ?? 0
              const f = (dialog as any).frame || {}
              baseLeft = f.left ?? 0
              baseTop = f.top ?? 0
            })
            el.on("mouseup", () => {
              dragging = false
            })
            el.on("mousemove", (e: any) => {
              if (!dragging) return
              const dims = term()
              const w = layout.width + 4
              const h = layout.height + 12
              const nextLeft = Math.max(0, Math.min(baseLeft + ((e?.x ?? 0) - startX), Math.max(0, dims.width - w)))
              const nextTop = Math.max(1, Math.min(baseTop + ((e?.y ?? 0) - startY), Math.max(1, dims.height - h)))
              dialog.setFrame?.({ width: w, height: h, left: nextLeft, top: nextTop })
            })
          }}
        >
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Kanban Control Room
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>

        <text fg={theme.textMuted} wrapMode="word">
          Navigate with ←/→, focus cards with ↑/↓, move cards with ctrl+←/→, press a to capture a new slice of work.
        </text>
        <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <box flexDirection="row" gap={0} alignItems="center">
            <text
              fg={layout.width > layoutBounds.minWidth ? theme.textMuted : theme.border}
              attributes={LINK_ATTRS}
              onMouseUp={() => adjustWidth(-layoutBounds.step)}
            >
              −
            </text>
            <text fg={theme.textMuted}>{layout.width}c</text>
            <text
              fg={layout.width < layoutBounds.maxWidth ? theme.textMuted : theme.border}
              attributes={LINK_ATTRS}
              onMouseUp={() => adjustWidth(layoutBounds.step)}
            >
              +
            </text>
          </box>
          <box flexDirection="row" gap={0} alignItems="center">
            <text
              fg={layout.height > layoutBounds.minHeight ? theme.textMuted : theme.border}
              attributes={LINK_ATTRS}
              onMouseUp={() => adjustHeight(-layoutBounds.step)}
            >
              −
            </text>
            <text fg={theme.textMuted}>{layout.height}l</text>
            <text
              fg={layout.height < layoutBounds.maxHeight ? theme.textMuted : theme.border}
              attributes={LINK_ATTRS}
              onMouseUp={() => adjustHeight(layoutBounds.step)}
            >
              +
            </text>
          </box>
          <text fg={theme.textMuted} attributes={LINK_ATTRS} onMouseUp={() => setCompact((value) => !value)}>
            {compact() ? "expand cards" : "compact cards"} (c)
          </text>
        </box>
        <box minHeight={layout.height} flexDirection="row" gap={1} justifyContent="center" flexWrap="no-wrap">
          <For each={board.columns}>
            {(column, idxAccessor) => {
              const idx = idxAccessor()
              const isActive = createMemo(() => board.focus.column === idx)
              return (
                <box
                  flexDirection="column"
                  width={columnWidth()}
                  flexGrow={0}
                  flexShrink={0}
                  backgroundColor={isActive() ? theme.backgroundElement : theme.backgroundPanel}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  gap={1}
                >
                  <box flexDirection="row" justifyContent="space-between" alignItems="center">
                    <text fg={theme[column.accent] ?? theme.primary} attributes={TextAttributes.BOLD}>
                      {column.title}
                    </text>
                    <text fg={theme.textMuted}>
                      {column.wip.current}/{column.wip.limit}
                    </text>
                  </box>
                  <text fg={theme.textMuted} wrapMode="word">
                    {column.subtitle}
                  </text>
                  <text
                    fg={theme[column.accent] ?? theme.primary}
                    attributes={LINK_ATTRS}
                    onMouseUp={() => createCard(idx)}
                  >
                    + Add
                  </text>
                  <scrollbox height={scrollHeight()} scrollbarOptions={{ visible: false }}>
                    <Show when={column.cards.length === 0}>
                      <box padding={1} backgroundColor={theme.background}>
                        <text fg={theme.textMuted}>No work tracked</text>
                      </box>
                    </Show>
                    <For each={column.cards}>
                      {(card, cardIdxAccessor) => {
                        const cardIdx = cardIdxAccessor()
                        const isCardActive = createMemo(() => isActive() && board.focus.card === cardIdx)
                        return (
                          <box
                            flexDirection="column"
                            gap={compact() ? 0 : 1}
                            marginBottom={compact() ? 0 : 1}
                            paddingLeft={1}
                            paddingRight={1}
                            paddingTop={compact() ? 0 : 1}
                            paddingBottom={compact() ? 0 : 1}
                            backgroundColor={
                              isCardActive() ? (theme[column.accent] ?? theme.primary) : theme.background
                            }
                            onMouseUp={() => {
                              setBoard(
                                produce((draft) => {
                                  draft.focus.column = idx
                                  draft.focus.card = cardIdx
                                }),
                              )
                            }}
                          >
                            <text
                              fg={isCardActive() ? theme.background : theme.text}
                              attributes={TextAttributes.BOLD}
                              wrapMode="word"
                            >
                              {card.title}
                            </text>
                            <Show when={!compact()}>
                              <text fg={isCardActive() ? theme.background : theme.textMuted} wrapMode="word">
                                {card.summary}
                              </text>
                            </Show>
                            <Show when={!compact()}>
                              <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                                <text fg={isCardActive() ? theme.background : theme.textMuted}>@{card.owner}</text>
                                <text fg={isCardActive() ? theme.background : theme.textMuted}>{card.eta}</text>
                                <text fg={riskColor(theme, card.risk, isCardActive())}>{card.points} pts</text>
                                <Show when={card.blocked}>
                                  <text fg={theme.error}>blocked</text>
                                </Show>
                              </box>
                            </Show>
                            <box flexDirection="row" gap={1} flexWrap="wrap">
                              <For each={card.tags}>
                                {(tag) => (
                                  <box
                                    backgroundColor={isCardActive() ? theme.background : theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text
                                      fg={isCardActive() ? (theme[column.accent] ?? theme.primary) : theme.textMuted}
                                    >
                                      #{tag}
                                    </text>
                                  </box>
                                )}
                              </For>
                            </box>
                          </box>
                        )
                      }}
                    </For>
                  </scrollbox>
                  <box flexDirection="row" gap={1} justifyContent="space-between" alignItems="center">
                    <text fg={theme.textMuted} wrapMode="word">
                      {column.focus}
                    </text>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <text fg={theme.textMuted} attributes={LINK_ATTRS} onMouseUp={() => shiftCard(-1)}>
                        ←
                      </text>
                      <text fg={theme.textMuted} attributes={LINK_ATTRS} onMouseUp={() => shiftCard(1)}>
                        →
                      </text>
                    </box>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
        <Show when={activeCard()}>
          {(card) => (
            <box
              flexDirection="column"
              gap={1}
              paddingLeft={1}
              paddingRight={1}
              paddingBottom={1}
              backgroundColor={theme.background}
            >
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {card().title}
              </text>
              <text fg={theme.textMuted}>{card().summary}</text>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>
                  Owner: <span style={{ fg: theme.text }}>{card().owner}</span>
                </text>
                <text fg={theme.textMuted}>
                  ETA: <span style={{ fg: theme.text }}>{card().eta}</span>
                </text>
                <text fg={riskColor(theme, card().risk, false)}>Risk: {card().risk.toUpperCase()}</text>
              </box>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <For each={card().tags}>
                  {(tag) => (
                    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                      <text fg={theme.accent}>#{tag}</text>
                    </box>
                  )}
                </For>
              </box>
            </box>
          )}
        </Show>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>ctrl+←/→ move card · c toggle compact · a add card · enter closes prompt</text>
          <text fg={theme.textMuted}>mock data only — persistence coming soon</text>
        </box>
      </box>
    </box>
  )
}

function riskColor(theme: ReturnType<typeof useTheme>["theme"], risk: KanbanCard["risk"], inverted: boolean) {
  if (risk === "high") return inverted ? theme.background : theme.error
  if (risk === "medium") return inverted ? theme.background : theme.warning
  return inverted ? theme.background : theme.success
}
