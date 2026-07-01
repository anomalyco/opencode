import { HoverCard as Kobalte } from "@kobalte/core/hover-card"
import { Show, type JSXElement } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import "./titlebar-tab-popover.css"

// Initial hover delay before the preview appears, per design.
const OPEN_DELAY = 200
// Mouse-out delay: begin closing immediately (a brief exit animation plays).
const CLOSE_DELAY = 0
// After a preview closes, hovering a neighbouring tab within this window skips
// the open delay — mirrors the tooltip's skipDelayDuration so moving across
// tabs doesn't re-wait the full delay each time.
const SKIP_WINDOW = 300
let lastClosedAt = 0

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

  // Kobalte reads openDelay lazily when the pointer enters the trigger, so this
  // resolves the skip window per-hover.
  const resolveOpenDelay = () => (Date.now() - lastClosedAt < SKIP_WINDOW ? 0 : OPEN_DELAY)
  const handleOpenChange = (open: boolean) => {
    if (!open) lastClosedAt = Date.now()
    props.onOpenChange(open)
  }

  return (
    <Kobalte
      open={props.open}
      onOpenChange={handleOpenChange}
      openDelay={resolveOpenDelay()}
      closeDelay={CLOSE_DELAY}
      // The preview is non-interactive (pointer-events: none), so there is no
      // safe area to traverse — leaving the tab hides it immediately.
      ignoreSafeArea
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
