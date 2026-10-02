import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createMemo, onCleanup, Show, Suspense, type Component, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Changes } from "../review/contract"
import { App, Command, useExtension, type SessionView } from "../sdk"
import type { Disclosure, SummaryPanelProps } from "./panel"

/** The summary button of one timeline header. Cached timelines each keep their own. */
export function SummaryHeader(props: {
  session: SessionView
  active: boolean
  panel: Component<SummaryPanelProps>
  disclosure: Disclosure
}) {
  const ctx = useExtension()
  const changes = ctx.use(Changes)
  const Panel = props.panel
  const [store, setStore] = createStore({ open: false, dismissed: false })
  const child = createMemo(() => !!props.session.server.data.session.get(props.session.id)?.parentID)
  const project = createMemo(() => props.session.project)
  createEffect(() => {
    if (props.active) return
    setStore("open", false)
  })
  // The changes row loads the session directory's changes only while the summary shows.
  createEffect(() => {
    const service = changes()
    if (!store.open || !service) return
    onCleanup(service.watch(props.session, "details"))
  })
  return (
    <Show when={!child() && project()}>
      {(project) => (
        <SummaryPopover active={props.active} open={store.open} onOpenChange={(open) => setStore("open", open)}>
          <Suspense>
            <Panel
              session={props.session}
              shown={store.open}
              project={project()}
              diffs={project().vcs ? changes()?.details(props.session) : []}
              moveDismissed={store.dismissed}
              onMoveDismiss={() => setStore("dismissed", true)}
              onReview={
                changes()
                  ? () => {
                      setStore("open", false)
                      changes()?.open(props.session)
                    }
                  : undefined
              }
              disclosure={props.disclosure}
            />
          </Suspense>
        </SummaryPopover>
      )}
    </Show>
  )
}

function SummaryPopover(props: ParentProps<{ active: boolean; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const ctx = useExtension()
  const app = ctx.use(App)
  // Cached timelines remain mounted; only the visible summary owns the command.
  onCleanup(
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
    ),
  )
  const keybind = () => [...app.keybind("summary.toggle")]
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
