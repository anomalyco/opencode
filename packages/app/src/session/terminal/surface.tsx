import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import type { ParentProps } from "solid-js"

export function TerminalSurface(
  props: ParentProps<{
    label: string
    opened: boolean
    present?: boolean
    framed?: boolean
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
      data-component="terminal-panel"
      data-opened={props.opened}
      data-size-animated={!props.resizing && (!props.desktop || props.stacked)}
      role="region"
      aria-label={props.label}
      aria-hidden={!props.opened}
      inert={!props.opened}
      class="relative shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "w-full": !props.desktop || props.stacked,
        "min-w-0 h-full flex-1": props.desktop && (props.present ?? props.opened) && !props.stacked,
        "w-0 h-full pointer-events-none": props.desktop && !(props.present ?? props.opened),
        "rounded-[10px] shadow-[var(--v2-elevation-raised)]": props.desktop && (props.framed ?? true),
        "will-change-[height]": !props.resizing && (!props.desktop || props.stacked),
      }}
      style={{ height: props.height, "--terminal-panel-height": props.contentHeight }}
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
        data-slot="terminal-panel-content"
        class="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
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
