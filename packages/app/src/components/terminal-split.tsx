import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Terminal } from "./terminal"
import { useTerminal, type Panel } from "@/context/terminal"
import { IconButton } from "@opencode-ai/ui/icon-button"

export interface TerminalSplitProps {
  tabId: string
}

function computeLayout(
  panels: Record<string, Panel>,
  panelId: string,
  bounds: { top: number; left: number; width: number; height: number },
): Map<string, { top: number; left: number; width: number; height: number }> {
  const result = new Map<string, { top: number; left: number; width: number; height: number }>()
  const panel = panels[panelId]
  if (!panel) return result

  if (panel.ptyId) {
    result.set(panel.ptyId, bounds)
  } else if (panel.children && panel.children.length === 2) {
    const [leftId, rightId] = panel.children
    const sizes = panel.sizes ?? [50, 50]

    if (panel.direction === "horizontal") {
      const topHeight = (bounds.height * sizes[0]) / 100
      const topBounds = { ...bounds, height: topHeight }
      const bottomBounds = { ...bounds, top: bounds.top + topHeight, height: bounds.height - topHeight }
      for (const [k, v] of computeLayout(panels, leftId, topBounds)) result.set(k, v)
      for (const [k, v] of computeLayout(panels, rightId, bottomBounds)) result.set(k, v)
    } else {
      const leftWidth = (bounds.width * sizes[0]) / 100
      const leftBounds = { ...bounds, width: leftWidth }
      const rightBounds = { ...bounds, left: bounds.left + leftWidth, width: bounds.width - leftWidth }
      for (const [k, v] of computeLayout(panels, leftId, leftBounds)) result.set(k, v)
      for (const [k, v] of computeLayout(panels, rightId, rightBounds)) result.set(k, v)
    }
  }

  return result
}

function findPanelForPty(panels: Record<string, Panel>, ptyId: string): string | undefined {
  for (const [id, panel] of Object.entries(panels)) {
    if (panel.ptyId === ptyId) return id
  }
}

export function TerminalSplit(props: TerminalSplitProps) {
  const terminal = useTerminal()
  const pane = createMemo(() => terminal.pane(props.tabId))
  const terminals = createMemo(() => terminal.all().filter((t) => t.tabId === props.tabId))
  const [containerFocused, setContainerFocused] = createSignal(true)

  const layout = createMemo(() => {
    const p = pane()
    if (!p) {
      const single = terminals()[0]
      if (!single) return new Map()
      return new Map([[single.id, { top: 0, left: 0, width: 100, height: 100 }]])
    }
    return computeLayout(p.panels, p.root, { top: 0, left: 0, width: 100, height: 100 })
  })

  const focused = createMemo(() => {
    const p = pane()
    if (!p) return props.tabId
    const focusedPanel = p.panels[p.focused ?? ""]
    return focusedPanel?.ptyId ?? props.tabId
  })

  const handleFocus = (ptyId: string) => {
    const p = pane()
    if (!p) return
    const panelId = findPanelForPty(p.panels, ptyId)
    if (panelId) terminal.focus(props.tabId, panelId)
  }

  const handleClose = (ptyId: string) => {
    const pty = terminal.all().find((t) => t.id === ptyId)
    if (!pty) return

    const p = pane()
    if (!p) {
      if (pty.tabId === props.tabId) {
        terminal.closeTab(props.tabId)
      }
      return
    }
    const panelId = findPanelForPty(p.panels, ptyId)
    if (panelId) terminal.closeSplit(props.tabId, panelId)
  }

  return (
    <div
      class="relative size-full"
      data-terminal-split-container
      onFocusIn={() => setContainerFocused(true)}
      onFocusOut={(e) => {
        const related = e.relatedTarget as Node | null
        if (!related || !e.currentTarget.contains(related)) {
          setContainerFocused(false)
        }
      }}
    >
      <For each={terminals()}>
        {(pty) => {
          const bounds = createMemo(() => layout().get(pty.id) ?? { top: 0, left: 0, width: 100, height: 100 })
          const isFocused = createMemo(() => focused() === pty.id)
          const hasSplits = createMemo(() => !!pane())

          return (
            <div
              class="absolute flex flex-col min-h-0"
              classList={{
                "ring-1 ring-inset ring-border-strong-base": containerFocused() && isFocused(),
                "border-l border-border-weak-base": bounds().left > 0,
                "border-t border-border-weak-base": bounds().top > 0,
              }}
              style={{
                top: `${bounds().top}%`,
                left: `${bounds().left}%`,
                width: `${bounds().width}%`,
                height: `${bounds().height}%`,
              }}
              onClick={() => handleFocus(pty.id)}
            >
              <Show when={pane()}>
                <div class="absolute top-1 right-1 z-10 opacity-0 hover:opacity-100 transition-opacity">
                  <IconButton
                    icon="close"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleClose(pty.id)
                    }}
                  />
                </div>
              </Show>
              <div
                class="flex-1 min-h-0"
                classList={{ "opacity-50": !containerFocused() || (hasSplits() && !isFocused()) }}
              >
                <Terminal
                  pty={pty}
                  focused={isFocused()}
                  onCleanup={terminal.update}
                  onConnectError={() => terminal.clone(pty.id)}
                  onExit={() => handleClose(pty.id)}
                  class="size-full"
                />
              </div>
            </div>
          )
        }}
      </For>
      <ResizeHandles tabId={props.tabId} />
    </div>
  )
}

function ResizeHandles(props: { tabId: string }) {
  const terminal = useTerminal()
  const pane = createMemo(() => terminal.pane(props.tabId))

  const splits = createMemo(() => {
    const p = pane()
    if (!p) return []
    return Object.values(p.panels).filter((panel) => panel.children && panel.children.length === 2)
  })

  return <For each={splits()}>{(panel) => <ResizeHandle tabId={props.tabId} panelId={panel.id} />}</For>
}

function ResizeHandle(props: { tabId: string; panelId: string }) {
  const terminal = useTerminal()
  const pane = createMemo(() => terminal.pane(props.tabId))
  const panel = createMemo(() => pane()?.panels[props.panelId])

  let cleanup: VoidFunction | undefined

  onCleanup(() => cleanup?.())

  const position = createMemo(() => {
    const p = pane()
    if (!p) return null
    const pan = panel()
    if (!pan?.children || pan.children.length !== 2) return null

    const bounds = computePanelBounds(p.panels, p.root, props.panelId, {
      top: 0,
      left: 0,
      width: 100,
      height: 100,
    })
    if (!bounds) return null

    const sizes = pan.sizes ?? [50, 50]

    if (pan.direction === "horizontal") {
      return {
        horizontal: true,
        top: bounds.top + (bounds.height * sizes[0]) / 100,
        left: bounds.left,
        size: bounds.width,
      }
    }
    return {
      horizontal: false,
      top: bounds.top,
      left: bounds.left + (bounds.width * sizes[0]) / 100,
      size: bounds.height,
    }
  })

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault()

    const pos = position()
    if (!pos) return

    const container = (e.target as HTMLElement).closest("[data-terminal-split-container]") as HTMLElement
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pan = panel()
    if (!pan) return

    const p = pane()
    if (!p) return
    const panelBounds = computePanelBounds(p.panels, p.root, props.panelId, {
      top: 0,
      left: 0,
      width: 100,
      height: 100,
    })
    if (!panelBounds) return

    const handleMouseMove = (e: MouseEvent) => {
      if (pan.direction === "horizontal") {
        const totalPx = (rect.height * panelBounds.height) / 100
        const topPx = (rect.height * panelBounds.top) / 100
        const posPx = e.clientY - rect.top - topPx
        const percent = Math.max(10, Math.min(90, (posPx / totalPx) * 100))
        terminal.resizeSplit(props.tabId, props.panelId, [percent, 100 - percent])
      } else {
        const totalPx = (rect.width * panelBounds.width) / 100
        const leftPx = (rect.width * panelBounds.left) / 100
        const posPx = e.clientX - rect.left - leftPx
        const percent = Math.max(10, Math.min(90, (posPx / totalPx) * 100))
        terminal.resizeSplit(props.tabId, props.panelId, [percent, 100 - percent])
      }
    }

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      cleanup = undefined
    }

    cleanup = handleMouseUp
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  return (
    <Show when={position()}>
      {(pos) => (
        <div
          data-component="resize-handle"
          data-direction={pos().horizontal ? "vertical" : "horizontal"}
          class="absolute"
          style={{
            top: `${pos().top}%`,
            left: `${pos().left}%`,
            width: pos().horizontal ? `${pos().size}%` : "8px",
            height: pos().horizontal ? "8px" : `${pos().size}%`,
            transform: pos().horizontal ? "translateY(-50%)" : "translateX(-50%)",
            cursor: pos().horizontal ? "row-resize" : "col-resize",
          }}
          onMouseDown={handleMouseDown}
        />
      )}
    </Show>
  )
}

function computePanelBounds(
  panels: Record<string, Panel>,
  currentId: string,
  targetId: string,
  bounds: { top: number; left: number; width: number; height: number },
): { top: number; left: number; width: number; height: number } | null {
  if (currentId === targetId) return bounds

  const panel = panels[currentId]
  if (!panel?.children || panel.children.length !== 2) return null

  const [leftId, rightId] = panel.children
  const sizes = panel.sizes ?? [50, 50]
  const horizontal = panel.direction === "horizontal"

  if (horizontal) {
    const topHeight = (bounds.height * sizes[0]) / 100
    const bottomHeight = bounds.height - topHeight
    const topBounds = { ...bounds, height: topHeight }
    const bottomBounds = { ...bounds, top: bounds.top + topHeight, height: bottomHeight }
    return (
      computePanelBounds(panels, leftId, targetId, topBounds) ??
      computePanelBounds(panels, rightId, targetId, bottomBounds)
    )
  }

  const leftWidth = (bounds.width * sizes[0]) / 100
  const rightWidth = bounds.width - leftWidth
  const leftBounds = { ...bounds, width: leftWidth }
  const rightBounds = { ...bounds, left: bounds.left + leftWidth, width: rightWidth }
  return (
    computePanelBounds(panels, leftId, targetId, leftBounds) ??
    computePanelBounds(panels, rightId, targetId, rightBounds)
  )
}
