import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useComposerLaneAlignment } from "./composer-lane"
import "./activity-chips.css"

export type SessionActivityItem = {
  key: string
  type: "subagent" | "shell"
  label?: string
  agent?: string
  sessionID?: string
  target: string
  // When the work started running, from the server's record of it.
  started: number
}

type DurationKey =
  | "ui.message.duration.seconds"
  | "ui.message.duration.minutesSeconds"
  | "ui.message.duration.hoursMinutes"

// 12s, 1m 05s, 1h 02m: the trailing unit is padded so ticking keeps the same digit count.
export function formatElapsed(ms: number, t: (key: DurationKey, params: Record<string, string>) => string) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number) => String(value).padStart(2, "0")

  if (total < 60) return t("ui.message.duration.seconds", { count: String(total) })

  if (total < 3600)
    return t("ui.message.duration.minutesSeconds", {
      minutes: String(Math.floor(total / 60)),
      seconds: pad(total % 60),
    })

  return t("ui.message.duration.hoursMinutes", {
    hours: String(Math.floor(total / 3600)),
    minutes: pad(Math.floor(total / 60) % 60),
  })
}

// Live work above the composer, one capsule like the iOS app's background-work summary, in the composer lane.
export function SessionActivityChips(props: {
  subagents: readonly SessionActivityItem[]
  shells: readonly SessionActivityItem[]
  onOpen: (item: SessionActivityItem) => void
  onStop: (item: SessionActivityItem) => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  const active = () =>
    settings.general.backgroundActivity() !== "off" && (props.subagents.length > 0 || props.shells.length > 0)

  const alignment = useComposerLaneAlignment()

  const placement = () => (({ center: "top", start: "top-start", end: "top-end" }) as const)[alignment()]

  // A subagent can only be interrupted once its child session exists.
  const stoppable = (item: SessionActivityItem) => item.type === "shell" || !!item.sessionID

  const row = (item: SessionActivityItem) => ({
    "data-stoppable": stoppable(item) || undefined,
    onSelect: () => props.onOpen(item),
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || !stoppable(item)) return

      event.preventDefault()
      props.onStop(item)
    },
  })

  // One clock for every row, ticking only while the panel is open.
  const [open, setOpen] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!open() || !active()) return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  // The run time and the stop button share the row's end; hovering a stoppable row swaps one for the other.
  const end = (item: SessionActivityItem) => (
    <span data-slot="session-activity-end">
      <span
        data-slot="session-activity-elapsed"
        dir="auto"
        class="text-[11px] tabular-nums whitespace-nowrap text-v2-text-text-muted"
      >
        {formatElapsed(now() - item.started, language.t)}
      </span>
      {stop(item)}
    </span>
  )

  const stop = (item: SessionActivityItem) => (
    <Show when={stoppable(item)}>
      {/* The row selects on press, so the stop button keeps its pointer events to itself. */}
      <IconButton
        type="button"
        size="small"
        variant="ghost-muted"
        tabIndex={-1}
        data-slot="session-activity-stop"
        icon={<Icon name="outline-xmark" size="small" />}
        aria-label={language.t(item.type === "shell" ? "session.running.stop.shell" : "session.running.stop.subagent")}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          props.onStop(item)
        }}
      />
    </Show>
  )

  const label = () => language.activitySummary({ subagents: props.subagents.length, shells: props.shells.length })

  // Each session mounts its own composer, so a capsule that is already there on a switch stays at rest; only work
  // that starts while the session is open fades in.
  const [enter, setEnter] = createSignal(!active())
  createEffect(() => {
    if (active()) return
    setEnter(true)
    setOpen(false)
  })

  return (
    <Show when={active()}>
      <div data-component="session-activity-chips" class="flex min-w-0 shrink items-center">
        <Menu gutter={8} placement={placement()} onOpenChange={setOpen}>
          <Menu.Trigger
            as="button"
            type="button"
            data-slot="session-activity-chip"
            aria-label={label()}
            class="pointer-events-auto flex h-7 min-w-0 max-w-full items-center gap-2 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base ps-2.5 pe-2.5 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] whitespace-nowrap tabular-nums text-v2-text-text-base shadow-[var(--v2-elevation-raised)] outline-none duration-150 ease-out motion-reduce:animate-none"
            classList={{ "animate-in fade-in": enter() }}
          >
            <SessionProgressIndicatorV2 class="shrink-0" />
            <span data-slot="session-activity-summary" class="flex min-w-0 items-center gap-2 overflow-hidden">
              {language.activitySummaryRich(
                { subagents: props.subagents.length, shells: props.shells.length },
                (text) => (
                  <span class="truncate">
                    <bdi>{text}</bdi>
                  </span>
                ),
              )}
            </span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              data-slot="session-activity-panel"
              aria-label={label()}
              onFocusIn={(event: FocusEvent) => {
                if (!(event.target instanceof HTMLElement)) return
                const row = event.target.closest<HTMLElement>('[data-component="menu-v2-item"]')

                if (!row) return
                // Kobalte's scroll adjustment ignores scroll-padding; native scrolling keeps the ring clear of the edge.
                queueMicrotask(() => row.scrollIntoView({ block: "nearest", inline: "nearest" }))
              }}
            >
              <For each={props.subagents}>
                {(item) => (
                  <Menu.Item {...row(item)}>
                    <SessionProgressIndicatorV2 class="shrink-0 text-v2-icon-icon-muted" />
                    <span class="shrink-0 font-[530]">
                      <bdi>
                        {item.agent
                          ? `${item.agent[0].toUpperCase()}${item.agent.slice(1)}`
                          : language.t("ui.tool.agent.default")}
                      </bdi>
                    </span>
                    <span dir="auto" class="min-w-0 flex-1 truncate text-v2-text-text-muted">
                      {item.label}
                    </span>
                    {end(item)}
                  </Menu.Item>
                )}
              </For>
              <For each={props.shells}>
                {(item) => (
                  <Menu.Item {...row(item)}>
                    <Icon name="console" class="shrink-0 text-v2-icon-icon-muted" />
                    <span
                      dir="ltr"
                      class="min-w-0 flex-1 truncate font-mono text-[13px] tracking-[-0.04px] text-v2-text-text-base"
                    >
                      {item.label}
                    </span>
                    {end(item)}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </div>
    </Show>
  )
}
