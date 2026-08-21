import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import type { ParentProps } from "solid-js"

export function TerminalSurface(
  props: ParentProps<{
    label: string
    opened: boolean
    desktop: boolean
    stacked: boolean
    height: string
    contentHeight: string
    pane: number
    max: number
    resizing: boolean
    onResizeStart: () => void
    onResize: (height: number) => void
    onCollapse: () => void
    ref?: (element: HTMLElement) => void
  }>,
) {
  return (
    <aside
      ref={props.ref}
      id="terminal-panel"
      role="region"
      aria-label={props.label}
      aria-hidden={!props.opened}
      inert={!props.opened}
      class="relative shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "w-full": !props.desktop || props.stacked,
        "min-w-0 h-full flex-1": props.desktop && props.opened && !props.stacked,
        "w-0 h-full pointer-events-none": props.desktop && !props.opened,
        "rounded-[10px] shadow-[var(--v2-elevation-raised)]": props.desktop,
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none":
          !props.desktop && !props.resizing,
      }}
      style={{ height: props.height }}
    >
      <div classList={{ "md:hidden": !props.stacked, hidden: props.stacked }} onPointerDown={props.onResizeStart}>
        <ResizeHandle
          class="-top-1"
          direction="vertical"
          size={props.pane}
          min={100}
          max={props.max}
          collapseThreshold={50}
          onResize={props.onResize}
          onCollapse={props.onCollapse}
        />
      </div>
      <div
        class="absolute inset-0 flex flex-col overflow-hidden"
        classList={{
          "border-t border-border-weak-base": props.opened && !props.desktop,
          "pointer-events-none": !props.opened,
        }}
        style={{ height: props.contentHeight }}
      >
        {props.children}
      </div>
    </aside>
  )
}
