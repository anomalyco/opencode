import type { ParentProps } from "solid-js"

export function SessionRouteFrame(props: ParentProps<{ padded?: boolean }>) {
  return (
    <div class="relative flex size-full flex-col overflow-hidden" classList={{ "p-2": props.padded }}>
      {props.children}
    </div>
  )
}

export function SessionPanelFrame(props: ParentProps<{ raised?: boolean }>) {
  return (
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base"
      classList={{
        "shadow-[var(--v2-elevation-raised)]": props.raised,
      }}
    >
      {props.children}
    </div>
  )
}
