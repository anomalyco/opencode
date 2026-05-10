/** @jsxImportSource solid-js */
import { createStore } from "solid-js/store"

const bubbleSize = {
  width: 280,
  height: 148,
  gap: 12,
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function getAnnotationBubblePosition(
  boundingBox: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    left: clamp(
      boundingBox.x + boundingBox.width + bubbleSize.gap,
      bubbleSize.gap,
      Math.max(bubbleSize.gap, viewport.width - bubbleSize.width - bubbleSize.gap),
    ),
    top: clamp(
      boundingBox.y,
      bubbleSize.gap,
      Math.max(bubbleSize.gap, viewport.height - bubbleSize.height - bubbleSize.gap),
    ),
  }
}

type AnnotationBubbleProps = {
  boundingBox: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  onConfirm: (comment: string) => void
  onCancel: () => void
}

export function AnnotationBubble(props: AnnotationBubbleProps) {
  const [state, setState] = createStore({ comment: "" })
  const position = () => getAnnotationBubblePosition(props.boundingBox, props.viewport)

  return (
    <div
      class="absolute z-10 w-[280px] rounded-lg border border-border-base bg-surface-raised-base p-3 shadow-sm"
      style={{
        left: `${position().left}px`,
        top: `${position().top}px`,
      }}
    >
      <textarea
        aria-label="Annotation comment"
        class="min-h-20 w-full resize-none rounded-md border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none"
        placeholder="Add a note about this element"
        value={state.comment}
        onInput={(event) => setState("comment", event.currentTarget.value)}
      />
      <div class="mt-2 flex items-center justify-end gap-2">
        <button type="button" class="h-8 rounded-md border border-border-base px-3 text-12-medium" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="h-8 rounded-md border border-border-base bg-surface-raised-stronger-base px-3 text-12-medium"
          disabled={!state.comment.trim()}
          onClick={() => props.onConfirm(state.comment)}
        >
          Save
        </button>
      </div>
    </div>
  )
}
