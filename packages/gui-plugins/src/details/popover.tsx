import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, onCleanup, Show, Suspense, untrack, type Component } from "solid-js"
import { Command, createKeyed, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type { DetailsPanelProps } from "./panel"
import {
  detailsPopoverFocusesContent,
  detailsPopoverOpen,
  initialDetailsPopoverState,
  transitionDetailsPopover,
  type DetailsPopoverEvent,
  type DetailsPopoverState,
  type DetailsPopoverVia,
} from "./popover-machine"
import type { McpControllers } from "./server-panel"

/** Every mounted details popover, so a shortcut finds the one on screen. */
export type DetailsMenus = Set<{ trigger: () => HTMLButtonElement | undefined; toggle: () => void }>

type DetailsProps = {
  menus: DetailsMenus
  session: MountedSession
  active: boolean
  panel: Component<DetailsPanelProps>
  mcp: McpControllers
}

/** The session details popover of one timeline header. Cached timelines each keep their own. */
export function DetailsHeader(props: DetailsProps) {
  return (
    <Show when={props.session.project}>
      <DetailsPopover
        menus={props.menus}
        session={props.session}
        active={props.active}
        panel={props.panel}
        mcp={props.mcp}
      />
    </Show>
  )
}

function DetailsPopover(props: DetailsProps) {
  const ctx = usePlugin()
  const keybinds = ctx.keybinds
  const Panel = props.panel
  const [popoverState, setPopoverState] = createSignal<DetailsPopoverState>(initialDetailsPopoverState)
  const open = () => detailsPopoverOpen(popoverState())

  let trigger: HTMLButtonElement | undefined
  let content: HTMLDivElement | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  // The trigger's latest click, which Kobalte reports just before it toggles the popover: a click without a pointer
  // (`detail` 0) comes from Enter or Space.
  let clickVia: DetailsPopoverVia = "keyboard"

  const dispatch = (event: DetailsPopoverEvent) => {
    const previous = untrack(popoverState)
    const next = transitionDetailsPopover(previous, event)

    if (next.state !== previous) setPopoverState(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "schedule-focus") {
        const attempt = effect.attempt
        clearTimeout(focusTimer)
        // Deferred like Kobalte's own autofocus, which runs once the content is in the document.
        focusTimer = setTimeout(() => dispatch({ type: "focus.due", attempt }))

        return
      }

      if (effect.type === "cancel-focus") return clearTimeout(focusTimer)

      content?.focus({ preventScroll: true })
    })
  }

  // Cached timelines stay mounted while hidden; routing away from the session closes its details.
  createKeyed(
    () => (ctx.sessions.current()?.visit === props.session.visit ? props.session.visit : undefined),
    () => onCleanup(() => dispatch({ type: "closed" })),
  )

  // Cached timelines remain mounted; only the visible details own the command. It leaves with this component.
  // A shortcut opens the popover without clicking its trigger.
  const self = {
    trigger: () => trigger,
    toggle: () => dispatch({ type: "toggled", via: "keyboard" }),
  }

  props.menus.add(self)
  onCleanup(() => {
    props.menus.delete(self)
    dispatch({ type: "disposed" })
  })

  ctx.add(Command, (): Command | undefined =>
    props.active
      ? {
          id: "toggle",
          title: ctx.t("command.toggle"),
          group: ctx.t("command.category.view"),
          section: "session",
          bind: "mod+shift+y",
          // A detached timeline can stay active, so the shortcut toggles the popover whose trigger is on screen.
          run: () => [...props.menus].find((menu) => menu.trigger()?.isConnected)?.toggle(),
        }
      : undefined,
  )

  const keybind = () => [...keybinds.keybind(`${ctx.id}.toggle`)]

  return (
    <Popover
      placement="bottom-end"
      gutter={8}
      overflowPadding={16}
      open={open()}
      onOpenChange={(next) => dispatch(next ? { type: "opened", via: clickVia } : { type: "closed" })}
    >
      <Popover.Anchor class="pointer-events-none absolute end-3 top-2.5 h-7 w-0" aria-hidden="true" />
      <Tooltip
        placement="bottom"
        value={
          <>
            {ctx.t("tooltip")}
            <Show when={keybind().length > 0}>
              <Keybind keys={keybind()} variant="neutral" />
            </Show>
          </>
        }
      >
        <Popover.Trigger
          ref={trigger}
          as={IconButton}
          icon={<Icon name="window-analytics" />}
          variant="ghost-muted"
          size="large"
          state={open() ? "pressed" : undefined}
          aria-label={ctx.t("title")}
          aria-expanded={open()}
          onClick={(event: MouseEvent) => (clickVia = event.detail === 0 ? "keyboard" : "pointer")}
        />
      </Tooltip>
      <Popover.Portal>
        {/* Kobalte positions the content relatively, so it places the Extensions flyout. */}
        <Popover.Content
          ref={content}
          class="session-summary-popover z-50 border-0 bg-transparent outline-none"
          aria-label={ctx.t("title")}
          // Keys pressed in the popover, Escape included, stay out of the session view's shortcuts.
          data-prevent-autofocus
          // A pointer open focuses the popover itself, so its first row shows no focus ring beside the pointer.
          onOpenAutoFocus={(event: Event) => {
            if (!detailsPopoverFocusesContent(popoverState())) return
            event.preventDefault()
            dispatch({ type: "autofocus.intercepted" })
          }}
        >
          <Suspense>
            <Panel session={props.session} shown={open()} mcp={props.mcp} onClose={() => dispatch({ type: "closed" })} />
          </Suspense>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
