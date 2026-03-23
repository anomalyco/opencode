import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { IconButton } from "./icon-button"

export type TouchSelectionPosition = { top: number; left: number }

export function useTouchSelection() {
  const [hasSelection, setHasSelection] = createSignal(false)
  const [position, setPosition] = createSignal<TouchSelectionPosition | null>(null)

  const checkSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setHasSelection(false)
      setPosition(null)
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    if (rect.width === 0 && rect.height === 0) {
      setHasSelection(false)
      setPosition(null)
      return
    }

    setHasSelection(true)
    setPosition({
      top: rect.top - 44 + window.scrollY,
      left: rect.left + rect.width / 2,
    })
  }

  const handleSelectionChange = () => {
    setTimeout(checkSelection, 10)
  }

  const handleTouchEnd = () => {
    setTimeout(checkSelection, 100)
  }

  createEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("touchend", handleTouchEnd)
    document.addEventListener("mouseup", handleSelectionChange)

    onCleanup(() => {
      document.removeEventListener("selectionchange", handleSelectionChange)
      document.removeEventListener("touchend", handleTouchEnd)
      document.removeEventListener("mouseup", handleSelectionChange)
    })
  })

  return {
    hasSelection,
    position,
    clearSelection: () => {
      window.getSelection()?.removeAllRanges()
      setHasSelection(false)
      setPosition(null)
    },
  }
}

export function TouchSelectionToolbar(props: {
  position: TouchSelectionPosition | null
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
