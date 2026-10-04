import { Popover } from "@kobalte/core/popover"
import { useData } from "@opencode/session-ui/context"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, createSignal, For, on, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useExtension, type BackgroundTask } from "../sdk"

export function BackgroundWork(props: { tasks: readonly BackgroundTask[]; mobile?: boolean }) {
  const ctx = useExtension()
  const locale = ctx.locale
  const data = useData()
  const running = createMemo(() => props.tasks.length > 0)
  // A new period each time work starts or ends: the list closes when the last task ends and stays closed when work returns.
  const period = createMemo(on(running, () => ({})))
  const [opened, setOpened] = createSignal<object>()
  const open = () => opened() === period()
  const setOpen = (value: boolean) => setOpened(value ? period() : undefined)

  const taskType = (task: BackgroundTask) => {
    if (task.type === "shell") return ctx.t("ui.tool.shell")

    if (!task.agent) return ctx.t("ui.tool.agent.default")

    return task.agent.slice(0, 1).toUpperCase() + task.agent.slice(1)
  }

  return (
    <Popover
      open={open()}
      placement={props.mobile ? "top-end" : locale.direction() === "rtl" ? "right-end" : "left-end"}
      gutter={4}
      onOpenChange={setOpen}
    >
      <Show when={running()}>
        <Popover.Trigger
          as="button"
          type="button"
          data-component="session-background-summary"
          class="session-summary-row"
          aria-label={ctx.plural("background.tasksRunning", props.tasks.length)}
        >
          <Icon name="outline-arrow-to-corner-top-right" class="shrink-0 text-v2-icon-icon-muted" />
          <TextShimmer
            as="span"
            text={ctx.plural("background.tasksRunning", props.tasks.length)}
            active
            class="session-summary-label"
          />
        </Popover.Trigger>
      </Show>
      <Popover.Portal>
        <Popover.Content
          data-component="session-background-list"
          class="session-service-menu"
          aria-label={ctx.plural("background.tasksRunning", props.tasks.length)}
        >
          <For each={props.tasks.slice(0, 10)}>
            {(task) => (
              <Dynamic
                component={task.type === "subagent" ? "a" : "div"}
                data-component="session-background-list-item"
                class="session-service-row"
                classList={{
                  "hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none":
                    task.type === "subagent",
                }}
                href={task.type === "subagent" ? data.sessionHref?.(task.id) : undefined}
                onClick={(event: MouseEvent) => {
                  if (task.type !== "subagent" || !data.navigateToSession) return

                  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                  event.preventDefault()
                  setOpen(false)
                  data.navigateToSession(task.id)
                }}
              >
                <span class="shrink-0">{taskType(task)}</span>
                <span class="session-summary-label text-v2-text-text-faint">{task.label}</span>
              </Dynamic>
            )}
          </For>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
