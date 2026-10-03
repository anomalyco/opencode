import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, onCleanup, Show, Suspense, type Component, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Command, createKeyed, createVisitState, useExtension, type MountedSession } from "../sdk"
import type Details from "./index"
import type { Disclosure, DetailsPanelProps } from "./panel"

/** The session details button of one timeline header. Cached timelines each keep their own. */
export function DetailsHeader(props: {
  session: MountedSession
  active: boolean
  panel: Component<DetailsPanelProps>
  disclosure: Disclosure
}) {
  const changes = useExtension<typeof Details>().uses.changes
  const Panel = props.panel
  // Cached timelines stay mounted while hidden; routing away from the session closes its details.
  const [open, setOpen] = createVisitState(false)
  const [store, setStore] = createStore({ dismissed: false })
  const child = createMemo(() => !!props.session.server.data.session.get(props.session.id)?.parentID)
  const project = createMemo(() => props.session.project)

  // Review is optional: the changes row offers it only while the review extension is active.
  const review = createMemo(() => {
    const live = changes()

    if (live.status !== "active") return

    return {
      details: () => live.value.details(props.session),
      open: () => {
        setOpen(false)
        live.value.open(props.session)
      },
    }
  })

  // The changes row loads the session directory's changes only while the details show.
  createKeyed(changes, (service) =>
    createKeyed(
      () => open() && props.session,
      (session) => onCleanup(service.watch(session, "details")),
    ),
  )

  return (
    <Show when={!child() && project()}>
      {(project) => (
        <DetailsPopover active={props.active} open={open()} onOpenChange={setOpen}>
          <Suspense>
            <Panel
              session={props.session}
              shown={open()}
              project={project()}
              diffs={project().vcs ? review()?.details() : []}
              moveDismissed={store.dismissed}
              onMoveDismiss={() => setStore("dismissed", true)}
              onReview={review()?.open}
              disclosure={props.disclosure}
            />
          </Suspense>
        </DetailsPopover>
      )}
    </Show>
  )
}

function DetailsPopover(props: ParentProps<{ active: boolean; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const ctx = useExtension()
  const keybinds = ctx.keybinds

  // Cached timelines remain mounted; only the visible details own the command. It leaves with this component.
  ctx.add(Command, (): Command | undefined =>
    props.active
      ? {
          id: "toggle",
          title: ctx.t("command.toggle"),
          group: ctx.t("command.category.view"),
          section: "session",
          bind: "mod+shift+y",
          run: () => props.onOpenChange(!props.open),
        }
      : undefined,
  )

  const keybind = () => [...keybinds.keybind(`${ctx.id}.toggle`)]

  return (
    <Popover open={props.open} placement="bottom-end" gutter={8} overflowPadding={16} onOpenChange={props.onOpenChange}>
      {/* Match the button's vertical bounds; the 8px gutter plus 4px content padding gives a 12px card gap. */}
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
          as={IconButton}
          icon={<Icon name="window-analytics" />}
          variant="ghost-muted"
          size="large"
          state={props.open ? "pressed" : undefined}
          aria-label={ctx.t("title")}
          aria-expanded={props.open}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          class="session-summary-popover z-50 max-h-[calc(100dvh-96px)] overflow-y-auto border-0 bg-transparent p-1 outline-none"
          aria-label={ctx.t("title")}
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
