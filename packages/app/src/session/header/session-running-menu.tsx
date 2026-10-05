import type { BackgroundTask } from "@opencode/gui-extensions/sdk"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createEffect, createMemo, createUniqueId, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { useOpenSessionRoute } from "@/session/session-identity-header"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { SessionWorkingIndicator } from "./session-working-indicator"

const neutral = "light-dark(var(--v2-text-text-base), #ffffff)"

type RunningItem = {
  key: string
  type: "subagent" | "shell"
  label?: string
  agent?: string
  sessionID?: string
  target: string
}

export function SessionRunningMenu(props: {
  sessionID?: string
  // The session whose running work is listed: this one, or its parent inside a subagent.
  owner?: string
  blocking: readonly { type: "shell" | "subagent"; partID: string; id?: string; label?: string }[]
  tasks: readonly BackgroundTask[]
  onReveal?: (target: string) => void
  title?: string
}) {
  const language = useLanguage()
  const openRoute = useOpenSessionRoute()
  const server = useServer()
  const sdk = useServerSDK()
  const id = createUniqueId()
  const [menu, setMenu] = createStore({ open: false })
  const [appearance, setAppearance] = createStore<{
    group?: HTMLElement
    entered: boolean
  }>({ entered: false })
  const sessionAgent = (id: string | undefined) => (id ? server.ctx.data.session.get(id)?.agent : undefined)

  // Foreground shells stay out: the timeline already shows them at the bottom.
  const items = createMemo<RunningItem[]>(() => [
    ...props.blocking.flatMap((task) =>
      task.type === "subagent"
        ? [
            {
              ...task,
              key: task.id ?? task.partID,
              agent: sessionAgent(task.id),
              sessionID: task.id,
              target: task.partID,
            },
          ]
        : [],
    ),
    ...props.tasks.flatMap((task) =>
      task.type === "subagent"
        ? [{ ...task, key: task.id, agent: task.agent ?? sessionAgent(task.id), sessionID: task.id, target: task.id }]
        : [],
    ),
    ...props.tasks.flatMap((task) => (task.type === "shell" ? [{ ...task, key: task.id, target: task.id }] : [])),
  ])

  const viewing = (item: RunningItem) => !!item.sessionID && item.sessionID === props.sessionID

  const label = createMemo(() => {
    const count = props.title ? items().filter((item) => !viewing(item)).length : items().length

    if (!count || (!props.title && count === 1 && viewing(items()[0]))) return undefined

    if (items().some((item) => item.type === "shell")) {
      return language.plural(props.title ? "session.running.additionalRunning" : "session.running.running", count)
    }

    return language.plural(props.title ? "session.running.additionalWorking" : "session.running.working", count)
  })

  const presence = createAnimatedPresence(
    label,
    () => appearance.group ?? null,
    () => props.sessionID,
  )
  // Label updates change presence state without changing visibility.
  const visible = createMemo(presence.show)

  createEffect(
    on(
      visible,
      (show) => {
        if (show) {
          setAppearance("entered", false)
          return
        }

        setMenu("open", false)
      },
      { defer: true },
    ),
  )

  const open = (item: RunningItem) => {
    const current = props.sessionID

    if (!current || viewing(item)) return

    if (item.sessionID) return openRoute(current, item.sessionID)

    // Shell calls and starting subagent calls live in the owner's timeline, which reveals them once open.
    if (props.owner && props.owner !== current) return openRoute(current, props.owner, item.target)

    if (props.onReveal) return props.onReveal(item.target)

    openRoute(current, current, item.target)
  }

  // A subagent can only be interrupted once its child session exists.
  const stoppable = (item: RunningItem) => item.type === "shell" || !!item.sessionID

  const stop = (item: RunningItem) => {
    const request = item.sessionID
      ? sdk.api.session.interrupt({ sessionID: item.sessionID })
      : sdk.api.shell.remove({
          id: item.target,
          location: { directory: server.ctx.data.shell.get(item.target)?.location.directory },
        })

    void request.catch((error) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      }),
    )
  }

  return (
    <Show when={props.title || presence.present()}>
      <div
        ref={(element) => {
          if (!props.title) setAppearance("group", element)
        }}
        inert={!props.title && !presence.show()}
        class="flex min-w-0 shrink-0 items-center gap-0.5 duration-150 ease-out motion-reduce:animate-none"
        classList={{
          "max-w-[45%]": !!props.title,
          "animate-in fade-in": !props.title && presence.animate() && presence.show() && !appearance.entered,
          "animate-out fade-out fill-mode-forwards": !props.title && presence.animate() && !presence.show(),
        }}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && presence.show()) setAppearance("entered", true)
        }}
      >
        <Show when={!props.title}>
          <span
            aria-hidden="true"
            class="shrink-0 ps-2 pe-1 text-[11px] font-medium leading-text-compact text-v2-text-text-faint"
          >
            /
          </span>
        </Show>
        <Menu
          gutter={6}
          placement="bottom-start"
          open={menu.open && presence.show()}
          onOpenChange={(open) => setMenu("open", open)}
        >
          <Show
            when={props.title}
            fallback={
              <Menu.Trigger
                as="button"
                type="button"
                aria-label={presence.value()}
                class="flex h-7 shrink-0 items-center rounded-[6px] px-2 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] tabular-nums whitespace-nowrap text-v2-text-text-base outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus data-[expanded]:bg-v2-overlay-simple-overlay-hover"
              >
                <TextShimmer text={presence.value() ?? ""} active={presence.show()} />
              </Menu.Trigger>
            }
          >
            <h1
              data-slot="session-title-child"
              aria-label={props.title}
              class="min-w-0 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-base"
            >
              <Menu.Trigger
                as="button"
                type="button"
                disabled={!visible()}
                aria-labelledby={`${id}-title${visible() ? ` ${id}-count` : ""}`}
                class="flex h-7 max-w-full items-center gap-0.5 rounded-[6px] outline-none enabled:hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus data-[expanded]:bg-v2-overlay-simple-overlay-hover"
              >
                <SessionWorkingIndicator sessionID={props.sessionID} />
                <span id={`${id}-title`} dir="auto" class="min-w-0 truncate px-1">
                  {props.title}
                </span>
                <Show when={presence.present()}>
                  <span
                    id={`${id}-count`}
                    ref={(element) => setAppearance("group", element)}
                    class="shrink-0 ps-0.5 pe-1 tabular-nums text-v2-text-text-muted duration-150 ease-out motion-reduce:animate-none"
                    classList={{
                      "animate-in fade-in": presence.animate() && presence.show() && !appearance.entered,
                      "animate-out fade-out fill-mode-forwards": presence.animate() && !presence.show(),
                    }}
                    onAnimationEnd={(event) => {
                      if (event.target === event.currentTarget && presence.show()) setAppearance("entered", true)
                    }}
                  >
                    <TextShimmer text={presence.value() ?? ""} active={presence.show()} />
                  </span>
                </Show>
              </Menu.Trigger>
            </h1>
          </Show>
          <Menu.Portal>
            <Menu.Content class="w-60" aria-label={presence.value()}>
              <For each={items()}>
                {(item) => (
                  <Menu.Item
                    class="group/running-item"
                    classList={{ "!bg-v2-overlay-simple-overlay-hover": viewing(item) }}
                    aria-current={viewing(item) ? "page" : undefined}
                    onSelect={() => {
                      // Close before navigating: the router's transition would hold the close until this
                      // timeline detaches, and the menu would flash at the viewport origin.
                      setMenu("open", false)
                      open(item)
                    }}
                    onKeyDown={(event) => {
                      if ((event.key !== "Delete" && event.key !== "Backspace") || !stoppable(item)) return

                      event.preventDefault()
                      stop(item)
                    }}
                  >
                    <Show
                      when={item.type === "subagent"}
                      fallback={<Icon name="console" class="shrink-0 text-v2-icon-icon-muted" />}
                    >
                      {/* Built-in agents have theme tokens; any other agent keeps the neutral color. */}
                      <SessionProgressIndicatorV2
                        class="shrink-0"
                        style={{
                          color: item.agent ? `var(--v2-agent-${item.agent.toLowerCase()}-solid, ${neutral})` : neutral,
                        }}
                      />
                    </Show>
                    <span class="shrink-0 font-[530]">
                      {item.type === "shell"
                        ? language.t("ui.tool.shell")
                        : item.agent
                          ? `${item.agent[0].toUpperCase()}${item.agent.slice(1)}`
                          : language.t("ui.tool.agent.default")}
                    </span>
                    {/* Menu rows end 6px in for trailing controls; text alone ends 12px in, like the leading edge. */}
                    <span
                      dir="auto"
                      class="me-1.5 min-w-0 flex-1 truncate text-v2-text-text-muted"
                      classList={{
                        "group-hover/running-item:me-0 group-data-[highlighted]/running-item:me-0 [@media(hover:none)]:me-0":
                          stoppable(item),
                      }}
                    >
                      {item.label}
                    </span>
                    <Show when={stoppable(item)}>
                      {/* The button's own display rule outranks utilities, so this wrapper shows and hides it. */}
                      <span class="hidden shrink-0 group-hover/running-item:flex group-data-[highlighted]/running-item:flex [@media(hover:none)]:flex">
                        {/* The row selects on press, so the stop button keeps its pointer events to itself. */}
                        <IconButton
                          type="button"
                          size="small"
                          variant="ghost-muted"
                          tabIndex={-1}
                          icon={<Icon name="outline-xmark" />}
                          aria-label={language.t(
                            item.type === "shell" ? "session.running.stop.shell" : "session.running.stop.subagent",
                          )}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onPointerUp={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            stop(item)
                          }}
                        />
                      </span>
                    </Show>
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
