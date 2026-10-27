import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { onCleanup, Show, Suspense, type Component, type ParentProps } from "solid-js"
import { Command, createVisitState, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type { DetailsPanelProps } from "./panel"

/** Every mounted details popover, so a shortcut finds the one on screen. */
export type DetailsMenus = Set<{ trigger: () => HTMLButtonElement | undefined; toggle: () => void }>

/** The session details popover of one timeline header. Cached timelines each keep their own. */
export function DetailsHeader(props: {
  menus: DetailsMenus
  session: MountedSession
  active: boolean
  panel: Component<DetailsPanelProps>
}) {
  const Panel = props.panel
  // Cached timelines stay mounted while hidden; routing away from the session closes its details.
  const [open, setOpen] = createVisitState(false)

  return (
    <Show when={props.session.project}>
      <DetailsPopover menus={props.menus} active={props.active} open={open()} onOpenChange={setOpen}>
        <Suspense>
          <Panel session={props.session} shown={open()} onClose={() => setOpen(false)} />
        </Suspense>
      </DetailsPopover>
    </Show>
  )
}

function DetailsPopover(
  props: ParentProps<{ menus: DetailsMenus; active: boolean; open: boolean; onOpenChange: (open: boolean) => void }>,
) {
  const ctx = usePlugin()
  const keybinds = ctx.keybinds

  // Cached timelines remain mounted; only the visible details own the command. It leaves with this component.
  // A shortcut opens the popover without clicking its trigger.
  let trigger: HTMLButtonElement | undefined
  // How the popover last opened: a pointer open focuses the popover itself, so its first row shows no focus ring
  // beside the row the pointer opens.
  const opening = { pointer: false }

  const self = {
    trigger: () => trigger,
    toggle: () => {
      opening.pointer = false
      props.onOpenChange(!props.open)
    },
  }

  props.menus.add(self)
  onCleanup(() => props.menus.delete(self))

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
    <Popover placement="bottom-end" gutter={8} overflowPadding={16} open={props.open} onOpenChange={props.onOpenChange}>
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
          state={props.open ? "pressed" : undefined}
          aria-label={ctx.t("title")}
          aria-expanded={props.open}
          onPointerDown={() => (opening.pointer = true)}
          onKeyDown={() => (opening.pointer = false)}
        />
      </Tooltip>
      <Popover.Portal>
        {/* Kobalte positions the content relatively, so it places the Extensions flyout. Only the inner box scrolls,
            so the flyout beside it is not clipped. */}
        <Popover.Content
          class="session-summary-popover z-50 border-0 bg-transparent outline-none"
          aria-label={ctx.t("title")}
          // Keys pressed in the popover, Escape included, stay out of the session view's shortcuts.
          data-prevent-autofocus
          onOpenAutoFocus={(event: Event) => {
            if (!opening.pointer) return
            event.preventDefault()

            const content = event.currentTarget

            // Deferred like Kobalte's own autofocus, which runs once the content is in the document.
            if (content instanceof HTMLElement) setTimeout(() => content.focus({ preventScroll: true }))
          }}
        >
          <div class="max-h-[calc(100dvh-96px)] overflow-y-auto p-1">{props.children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
