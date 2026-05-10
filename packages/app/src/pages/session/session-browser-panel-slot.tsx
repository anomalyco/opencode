import { Show, type JSX } from "solid-js"
import { BrowserPanel } from "@/components/browser-panel"
import type { createLayoutPanelController } from "@/context/layout"

type BrowserPanelController = ReturnType<typeof createLayoutPanelController>

export function SessionBrowserPanelSlot(props: { panel: BrowserPanelController; visible: boolean }) {
  return (
    <div
      id="browser-panel"
      aria-hidden={!props.visible}
      inert={!props.visible}
      class="size-full min-w-0 h-full overflow-hidden bg-background-base [&_.browser-panel-shell]:h-full [&_.browser-panel-shell]:flex [&_.browser-panel-shell]:flex-col [&_.browser-panel-body]:h-auto [&_.browser-panel-body]:flex-1"
      classList={{ hidden: !props.visible }}
    >
      <BrowserPanel panel={props.panel} />
    </div>
  )
}

export function SessionSidePanelContentBranch(props: {
  browserOpen: () => boolean
  fallback: JSX.Element
  panel: BrowserPanelController
}) {
  return (
    <div class="size-full min-w-0 h-full">
      <SessionBrowserPanelSlot panel={props.panel} visible={props.browserOpen()} />
      <Show when={!props.browserOpen()}>{props.fallback}</Show>
    </div>
  )
}
