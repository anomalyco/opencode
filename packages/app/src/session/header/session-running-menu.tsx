import type { BackgroundTask } from "@opencode/gui-extensions/sdk"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { useOpenSessionRoute } from "@/session/session-identity-header"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

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
  onReveal: (target: string) => void
}) {
  const language = useLanguage()
  const openRoute = useOpenSessionRoute()
  const server = useServer()
  const sdk = useServerSDK()
  const [menu, setMenu] = createStore({ open: false })
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

  const label = createMemo(() => {
    const count = items().length

    if (items().some((item) => item.type === "shell")) return language.plural("session.running.running", count)

    return language.plural("session.running.working", count)
  })

  // Inside a subagent, its own row is listed among its siblings.
  const viewing = (item: RunningItem) => !!item.sessionID && item.sessionID === props.sessionID

  const open = (item: RunningItem) => {
    const current = props.sessionID

    if (!current || viewing(item)) return

    if (item.sessionID) return openRoute(current, item.sessionID)

    // Shell calls and starting subagent calls live in the owner's timeline, which reveals them once open.
    if (props.owner && props.owner !== current) return openRoute(current, props.owner, item.target)

    props.onReveal(item.target)
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
    <Show when={items().length > 0}>
      <Menu gutter={6} placement="bottom-start" open={menu.open} onOpenChange={(open) => setMenu("open", open)}>
        <Menu.Trigger
          as="button"
          type="button"
          aria-label={label()}
          // 8px from the ··· menu, or from the padded title inside a subagent, which has no menu.
          class={`${props.owner === props.sessionID ? "ms-1.5" : "ms-0.5"} flex h-7 shrink-0 items-center rounded-[6px] px-2 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus data-[expanded]:bg-v2-overlay-simple-overlay-hover`}
        >
          <TextShimmer text={label()} active />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content class="w-60" aria-label={label()}>
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
    </Show>
  )
}
