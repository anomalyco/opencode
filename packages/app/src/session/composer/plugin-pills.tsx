import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Popover } from "@kobalte/core/popover"
import { createMemo, For, Match, Show, Switch, untrack, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  ComposerPill,
  type ComposerPillProps,
  type ComposerPillTone,
  type ComposerPillView,
  type IconName,
  type MountedSession,
  type SessionScreen,
} from "@opencode/plugin/gui"
import { usePluginHost } from "@/runtime/plugin/host"
import { Contribution } from "@/runtime/plugin/render"
import { composerLanePlacement, type useComposerLaneAlignment } from "./composer-lane"


type Alignment = ReturnType<ReturnType<typeof useComposerLaneAlignment>>

const tones: Record<ComposerPillTone, string> = {
  success: "text-v2-state-fg-success",
  warning: "text-v2-state-fg-warning",
  danger: "text-v2-state-fg-danger",
}

// Plugin pills in the composer lane, after the app's own: on the side away from the lane's aligned edge. A pill with
// nothing to show renders no element, so the row hides while it is empty and takes no gap in the lane.
export function SessionPluginPills(props: {
  session: MountedSession
  screen: SessionScreen
  /** The lane's alignment, which places the pills and their menus. */
  alignment: Accessor<Alignment>
}) {
  const host = usePluginHost()
  const alignment = props.alignment

  const input: ComposerPillProps = {
    get session() {
      return props.session
    },
    get screen() {
      return props.screen
    },
  }

  const items = createMemo(() =>
    host.items(ComposerPill).toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)),
  )

  return (
    <Show when={items().length > 0}>
      <div
        data-component="session-plugin-pills"
        class="flex min-w-0 shrink items-center gap-2 [&:not(:has(*))]:hidden"
        classList={{ "-order-2": alignment() === "end", "order-2": alignment() !== "end" }}
      >
        <For each={items()}>
          {(item) => (
            <Contribution plugin={item.plugin}>
              {() => <PluginPill pill={item.value} input={input} alignment={alignment} />}
            </Contribution>
          )}
        </For>
      </div>
    </Show>
  )
}

function PluginPill(props: { pill: ComposerPill; input: ComposerPillProps; alignment: Accessor<Alignment> }) {
  const alignment = props.alignment
  const view = createMemo(() => props.pill.show(props.input))
  const [state, setState] = createStore({ open: false })

  return (
    <Show when={view()}>
      {(current) => (
        <Switch
          fallback={
            <button
              type="button"
              data-slot="session-plugin-pill"
              aria-label={current().title}
              data-composer-pill
              onClick={() => current().run?.()}
            >
              <Content view={current()} />
            </button>
          }
        >
          <Match when={props.pill.menu}>
            {(menu) => (
              <Popover
                open={state.open}
                onOpenChange={(open) => setState("open", open)}
                placement={composerLanePlacement(alignment())}
                gutter={8}
              >
                <Popover.Trigger
                  as="button"
                  type="button"
                  data-slot="session-plugin-pill"
                  aria-label={current().title}
                  data-composer-pill
                >
                  <Content view={current()} />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    data-slot="session-plugin-pill-popover"
                    aria-label={current().title ?? current().label}
                    data-composer-pill-panel
                    class="w-80 p-1"
                  >
                    <div class="px-2 pt-1 pb-1.5 text-[11px] font-[530] tracking-[0.05px] leading-[var(--line-height-tight)] text-v2-text-text-faint">
                      <span dir="auto" class="line-clamp-3 break-words">
                        {current().title ?? current().label}
                      </span>
                    </div>
                    {/* Untracked: the content renders once per open; its own reactivity updates it in place. */}
                    {untrack(() =>
                      menu()({
                        get session() {
                          return props.input.session
                        },
                        get screen() {
                          return props.input.screen
                        },
                        close: () => setState("open", false),
                      }),
                    )}
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
            )}
          </Match>
          <Match when={current().rows}>
            {(rows) => (
              <Menu gutter={8} placement={composerLanePlacement(alignment())}>
                <Menu.Trigger
                  as="button"
                  type="button"
                  data-slot="session-plugin-pill"
                  aria-label={current().title}
                  data-composer-pill
                >
                  <Content view={current()} />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content data-slot="session-plugin-pill-menu" aria-label={current().title ?? current().label}>
                    <Menu.Group>
                      <Menu.GroupLabel class="!h-auto max-w-80 !py-1.5">
                        <span dir="auto" class="line-clamp-3 break-words">
                          {current().title ?? current().label}
                        </span>
                      </Menu.GroupLabel>
                      <For each={rows()}>
                        {(row) => (
                          <Menu.Item
                            data-slot="session-plugin-pill-row"
                            disabled={!row.run}
                            onSelect={() => row.run?.()}
                            badge={row.detail}
                          >
                            <PillIcon name={row.icon} tone={row.tone} />
                            <span dir="auto" class="min-w-0 flex-1 truncate">
                              {row.label}
                            </span>
                          </Menu.Item>
                        )}
                      </For>
                    </Menu.Group>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            )}
          </Match>
        </Switch>
      )}
    </Show>
  )
}

function Content(props: { view: ComposerPillView }): JSX.Element {
  return (
    <>
      <PillIcon name={props.view.icon} tone={props.view.tone} />
      <span dir="auto" class="min-w-0 max-w-[260px] truncate">
        {props.view.label}
      </span>
    </>
  )
}

function PillIcon(props: { name?: IconName; tone?: ComposerPillTone }) {
  return (
    <Show when={props.name}>
      {(name) => (
        <Icon
          name={name()}
          size="small"
          class={`shrink-0 ${props.tone ? tones[props.tone] : "text-v2-icon-icon-muted"}`}
        />
      )}
    </Show>
  )
}
