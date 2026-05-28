import { Component, For } from "solid-js"
import type { createPromptDrawing } from "./drawing"

const picks = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"] as const

type ColorsProps = {
  drawing: ReturnType<typeof createPromptDrawing>
}

export const PromptDrawingColors: Component<ColorsProps> = (props) => {
  return (
    <div data-component="prompt-draw-colors" class="flex items-center gap-1 px-1">
      <For each={picks}>
        {(color) => (
          <button
            type="button"
            class="size-5.5 shrink-0 rounded-sm border border-border-base"
            classList={{ "ring-2 ring-icon-info-base ring-offset-1 ring-offset-surface-raised-stronger-non-alpha": props.drawing.stroke() === color }}
            style={{ "background-color": color }}
            aria-label={color}
            aria-pressed={props.drawing.stroke() === color}
            onClick={() => props.drawing.setStroke(color)}
          />
        )}
      </For>
    </div>
  )
}
