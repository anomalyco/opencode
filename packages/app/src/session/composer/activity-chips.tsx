import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import type { ShellOutputInput, ShellOutputOutput } from "@opencode/client/promise"
import { stripAnsi } from "@opencode/session-ui/tools/ansi"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useComposerLaneAlignment } from "./composer-lane"
import { createShellPanel, createShellTail, type ShellEnd } from "./shell-panel"
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
  shell: {
    directory: string
    output: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    ended: Parameters<typeof createShellPanel>[0]["ended"]
  }
  onOpen: (item: SessionActivityItem) => void
  onStop: (item: SessionActivityItem) => Promise<boolean>
  // The menu closed with nothing left running, so the capsule and its trigger are gone; focus goes to the composer.
  onEmpty: () => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  const [open, setOpen] = createSignal(false)
  const panel = createShellPanel({ shells: () => props.shells, stop: props.onStop, ended: props.shell.ended })

  // A shell that ended while its panel is open still counts until the menu closes.
  const held = () => {
    const shell = panel.state.shell

    return open() && shell && !props.shells.some((item) => item.key === shell.key) ? 1 : 0
  }

  const counts = () => ({ subagents: props.subagents.length, shells: props.shells.length + held() })

  const active = () =>
    settings.general.backgroundActivity() !== "off" && (counts().subagents > 0 || counts().shells > 0)

  const alignment = useComposerLaneAlignment()

  const placement = () => (({ center: "top", start: "top-start", end: "top-end" }) as const)[alignment()]

  // A subagent can only be interrupted once its child session exists.
  const stoppable = (item: SessionActivityItem) => item.type === "shell" || !!item.sessionID

  const row = (item: SessionActivityItem) => ({
    "data-stoppable": stoppable(item) || undefined,
    // A shell opens its own panel in place; a subagent opens where it runs.
    closeOnSelect: item.type !== "shell",
    onSelect: () => (item.type === "shell" ? panel.open(item) : props.onOpen(item)),
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || !stoppable(item)) return

      event.preventDefault()
      void props.onStop(item)
    },
  })

  // One clock for every row, ticking only while the panel is open.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!open() || !active()) return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const rows = new Map<string, HTMLElement>()
  let content: HTMLElement | undefined
  let back: HTMLElement | undefined

  // Focus moves a frame late: the menu refocuses itself when the selected row unmounts. One pending move at a time.
  let frame = 0
  const later = (move: () => void) => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(move)
  }
  onCleanup(() => cancelAnimationFrame(frame))

  // Opening a shell moves focus to its back arrow.
  createEffect(
    on(
      () => panel.state.shell?.key,
      (key) => key && later(() => open() && back?.focus()),
      { defer: true },
    ),
  )

  // Going back returns focus to that shell's row, or to the first row once the shell has ended and left the list. With
  // nothing left to list, going back closes the menu.
  const goBack = () => {
    const key = panel.state.shell?.key

    if (props.subagents.length + props.shells.length === 0) return changeOpen(false)
    panel.back()
    later(() => {
      if (!open()) return
      const row = key ? rows.get(key) : undefined

      if (row?.isConnected) return row.focus()
      content?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
  }

  // Stop gives way to how the shell ended; keep focus in the panel when it held Stop.
  createEffect(
    on(
      () => panel.state.end,
      (end) => {
        if (!end || !back) return
        const active = document.activeElement

        if (!active || active === document.body || !active.isConnected || active.matches('[role="menu"]')) back.focus()
      },
    ),
  )

  // The menu always opens on the list, and closing forgets the shell so nothing follows it while the menu is shut.
  const changeOpen = (value: boolean) => {
    const was = open()
    setOpen(value)

    if (value || !was) return
    panel.back()
    cancelAnimationFrame(frame)

    if (props.subagents.length + props.shells.length > 0) return
    later(() => {
      const active = document.activeElement

      if (!active || active === document.body || !active.isConnected) props.onEmpty()
    })
  }

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
          void props.onStop(item)
        }}
      />
    </Show>
  )

  const label = () => language.activitySummary(counts())

  // Each session mounts its own composer, so a capsule that is already there on a switch stays at rest; only work
  // that starts while the session is open fades in.
  const [enter, setEnter] = createSignal(!active())
  createEffect(() => {
    if (active()) return
    setEnter(true)
    changeOpen(false)
  })

  return (
    <Show when={active()}>
      <div data-component="session-activity-chips" class="flex min-w-0 shrink items-center">
        <Menu gutter={8} placement={placement()} open={open()} onOpenChange={changeOpen}>
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
              {language.activitySummaryRich(counts(), (text) => (
                <span class="truncate">
                  <bdi>{text}</bdi>
                </span>
              ))}
            </span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              data-slot="session-activity-panel"
              data-view={panel.state.shell ? "shell" : "list"}
              aria-label={label()}
              ref={content}
              onFocusIn={(event: FocusEvent) => {
                if (!(event.target instanceof HTMLElement)) return
                const row = event.target.closest<HTMLElement>('[data-component="menu-v2-item"]')

                if (!row) return
                // Kobalte's scroll adjustment ignores scroll-padding; native scrolling keeps the row clear of the edge.
                queueMicrotask(() => row.scrollIntoView({ block: "nearest", inline: "nearest" }))
              }}
            >
              <Show
                when={panel.state.shell}
                fallback={
                  <>
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
                        <Menu.Item {...row(item)} ref={(el: HTMLElement) => rows.set(item.key, el)}>
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
                  </>
                }
              >
                {(shell) => (
                  <>
                    <div data-slot="session-activity-shell-header">
                      <Menu.Item
                        data-slot="session-activity-back"
                        aria-label={language.t("session.activity.shell.back")}
                        closeOnSelect={false}
                        onSelect={goBack}
                        ref={(el: HTMLElement) => (back = el)}
                      >
                        <Icon name="arrow-left" size="small" />
                      </Menu.Item>
                      <span dir="ltr" data-slot="session-activity-shell-command" class="min-w-0 flex-1 truncate">
                        {shell().label}
                      </span>
                      <span
                        data-slot="session-activity-elapsed"
                        dir="auto"
                        class="text-[11px] tabular-nums whitespace-nowrap text-v2-text-text-muted"
                      >
                        {formatElapsed((panel.state.end?.completed ?? now()) - shell().started, language.t)}
                      </span>
                      <Show
                        when={panel.state.end}
                        fallback={
                          <Menu.Item
                            data-slot="session-activity-shell-stop"
                            closeOnSelect={false}
                            aria-disabled={panel.state.stopping || panel.state.ending || undefined}
                            onSelect={panel.stop}
                          >
                            {language.t(
                              panel.state.stopping ? "session.activity.shell.stopping" : "session.activity.shell.stop",
                            )}
                          </Menu.Item>
                        }
                      >
                        {(end) => (
                          <span
                            data-slot="session-activity-shell-status"
                            data-failed={
                              end().status === "timeout" || (end().status === "exited" && !!end().exit) || undefined
                            }
                            role="status"
                          >
                            {endLabel(end(), language.t)}
                          </span>
                        )}
                      </Show>
                    </div>
                    <ShellTail
                      id={shell().target}
                      directory={props.shell.directory}
                      running={!panel.state.end}
                      load={props.shell.output}
                    />
                  </>
                )}
              </Show>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </div>
    </Show>
  )
}

function endLabel(end: ShellEnd, t: ReturnType<typeof useLanguage>["t"]) {
  if (end.status === "timeout") return t("session.activity.shell.timeout")
  if (end.status === "killed") return t("session.activity.shell.killed")
  if (end.exit === undefined) return t("session.activity.shell.exited")

  return t("session.activity.shell.exitCode", { code: String(end.exit) })
}

const TAIL_LINES = 14

// The last lines of a shell's output, read the way the timeline reads it: escape codes stripped, carriage returns as
// line breaks.
function ShellTail(props: {
  id: string
  directory: string
  running: boolean
  load: (input: ShellOutputInput) => Promise<ShellOutputOutput>
}) {
  const language = useLanguage()
  const output = createShellTail({
    id: () => props.id,
    directory: () => props.directory,
    running: () => props.running,
    load: props.load,
  })

  const tail = createMemo(() =>
    stripAnsi(output()).replace(/\r\n?/g, "\n").trimEnd().split("\n").slice(-TAIL_LINES).join("\n"),
  )

  let scroller: HTMLDivElement | undefined
  // Wrapped lines can outgrow the box; keep the newest output in view.
  createEffect(
    on(tail, () => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    }),
  )

  return (
    <div data-slot="session-activity-shell-output" data-scrollable ref={scroller}>
      <Show
        when={tail()}
        fallback={<span data-slot="session-activity-shell-empty">{language.t("session.activity.shell.empty")}</span>}
      >
        <pre dir="ltr">
          <code>{tail()}</code>
        </pre>
      </Show>
    </div>
  )
}
