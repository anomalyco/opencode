import { HoverCard as Kobalte } from "@kobalte/core/hover-card"
import { Show, type JSXElement } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import "./titlebar-tab-popover.css"

// Initial hover delay before the preview appears, per design.
const OPEN_DELAY = 200
// Mouse-out delay: hide instantly.
const CLOSE_DELAY = 0

export interface TabPreviewData {
  projectName?: string
  title?: string
  path?: string
  branch?: string
  serverName?: string
}

export function TabPreviewPopover(props: {
  trigger: JSXElement
  open: boolean
  onOpenChange: (open: boolean) => void
  data: TabPreviewData
}) {
  let triggerEl: HTMLDivElement | undefined

  return (
    <Kobalte
      open={props.open}
      onOpenChange={props.onOpenChange}
      openDelay={OPEN_DELAY}
      closeDelay={CLOSE_DELAY}
      placement="bottom-start"
      gutter={6}
    >
      <Kobalte.Trigger ref={triggerEl} as="div" data-component="session-tab-popover-trigger" tabIndex={-1}>
        {props.trigger}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          ref={(el) => {
            // Portalled content lives outside the themed subtree, so mirror the
            // active theme like the v2 tooltip does.
            const theme = triggerEl?.closest("[data-theme]")?.getAttribute("data-theme")
            if (theme) el.setAttribute("data-theme", theme)
          }}
          data-component="session-tab-popover"
        >
          <div data-slot="header">
            <Show when={props.data.projectName}>
              <span data-slot="project">{props.data.projectName}</span>
            </Show>
            <Show when={props.data.title}>
              <span data-slot="title">{props.data.title}</span>
            </Show>
          </div>

          <Show when={props.data.path}>
            <div data-slot="row">
              <span data-slot="icon">
                <IconV2 name="folder" />
              </span>
              <span data-slot="detail">{props.data.path}</span>
            </div>
          </Show>

          <Show when={props.data.branch}>
            <div data-slot="row">
              <span data-slot="icon">
                <IconV2 name="branch" />
              </span>
              <span data-slot="detail">{props.data.branch}</span>
            </div>
          </Show>

          <Show when={props.data.serverName}>
            <div data-slot="server">{props.data.serverName}</div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
