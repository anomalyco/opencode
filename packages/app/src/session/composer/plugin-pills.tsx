import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
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
import type { useComposerLaneAlignment } from "./composer-lane"

const capsule =
  "pointer-events-auto flex h-7 min-w-0 max-w-full items-center gap-2 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base ps-2.5 pe-2.5 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base shadow-[var(--v2-elevation-raised)] outline-none"

type Alignment = ReturnType<ReturnType<typeof useComposerLaneAlignment>>

const tones: Record<ComposerPillTone, string> = {
  success: "text-v2-state-fg-success",
  warning: "text-v2-state-fg-warning",
  danger: "text-v2-state-fg-danger",
}

// Plugin pills in the composer lane, after the app's own: on the side away from the lane's aligned edge.
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
        class="flex min-w-0 shrink items-center gap-2"
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
  const placement = () => (({ center: "top", start: "top-start", end: "top-end" }) as const)[alignment()]

  return (
    <Show when={view()}>
      {(current) => (
        <Show
          when={current().rows}
          fallback={
            <button
              type="button"
              data-slot="session-plugin-pill"
              aria-label={current().title}
              class={capsule}
              onClick={() => current().run?.()}
            >
              <Content view={current()} />
            </button>
          }
        >
          {(rows) => (
            <Menu gutter={8} placement={placement()}>
              <Menu.Trigger
                as="button"
                type="button"
                data-slot="session-plugin-pill"
                aria-label={current().title}
                class={capsule}
              >
                <Content view={current()} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content data-slot="session-plugin-pill-menu" aria-label={current().title ?? current().label}>
                  <Menu.Group>
                    <Menu.GroupLabel>{current().title ?? current().label}</Menu.GroupLabel>
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
        </Show>
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
