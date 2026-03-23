import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { IconButton } from "./icon-button"

export type SelectionPosition = { top: number; left: number }

export interface SelectedLineRange {
  start: number
  end: number
}

function findLineFromNode(node: Node): number | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement) {
      const lineAttr = current.getAttribute("data-line")
      if (lineAttr) return parseInt(lineAttr, 10)
    }
    current = current.parentNode
  }
  return null
}

export function getTextSelectionLines(): SelectedLineRange | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  const startLine = findLineFromNode(range.startContainer)
  const endLine = findLineFromNode(range.endContainer)

  if (startLine === null || endLine === null) return null

  return {
    start: Math.min(startLine, endLine),
    end: Math.max(startLine, endLine),
  }
}

export function useTextSelection() {
  const [position, setPosition] = createSignal<SelectionPosition | null>(null)

  const checkSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setPosition(null)
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    if (rect.width === 0 && rect.height === 0) {
      setPosition(null)
      return
    }

    setPosition({
      top: rect.top - 44,
      left: rect.left + rect.width / 2,
    })
  }

  const handleSelectionChange = () => {
    setTimeout(checkSelection, 10)
  }

  createEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("mouseup", handleSelectionChange)

    onCleanup(() => {
      document.removeEventListener("selectionchange", handleSelectionChange)
      document.removeEventListener("mouseup", handleSelectionChange)
    })
  })

  return {
    position,
    clearSelection: () => {
      window.getSelection()?.removeAllRanges()
      setPosition(null)
    },
  }
}

export function SelectionToolbar(props: {
  position: SelectionPosition | null
  onAddComment: () => void
  onClose: () => void
}) {
  return (
    <Show when={props.position}>
      {(pos) => (
        <div
          class="fixed z-50 flex items-center gap-1 bg-surface-panel border border-border-base rounded-lg shadow-lg p-1"
          style={{
            top: `${pos().top}px`,
            left: `${pos().left}px`,
            transform: "translateX(-50%)",
          }}
        >
          <IconButton
            icon="plus-small"
            variant="ghost"
            size="small"
            onClick={() => {
              props.onAddComment()
              props.onClose()
            }}
            aria-label="Add comment"
          />
        </div>
      )}
    </Show>
  )
}

export { useTextSelection as useTouchSelection, SelectionToolbar as TouchSelectionToolbar }
