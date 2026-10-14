import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { useExtension, type MountedSession } from "../sdk"
import { childStatus, childrenCost, childrenOf, subagentTasks } from "./status"

function AgentsTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export function AgentsTabIcon(props: { session: MountedSession }) {
  const busy = createMemo(() => {
    if (!props.session.id) return false

    const data = props.session.server.data
    const tasks = subagentTasks(data.session.message.list(props.session.id))

    if (tasks.blocking.length > 0) return true

    return childrenOf(data.session.list(), props.session.id).some(
      (info) =>
        childStatus({
          part: tasks.parts.get(info.id),
          running: data.session.status(info.id) === "running",
          outcome: info.outcome,
        }) === "busy",
    )
  })

  return (
    <div class="relative">
      <Icon name="bullet-list" size="small" />
      <Show when={busy()}>
        <span class="absolute -top-1 -right-1 size-2 rounded-full bg-v2-background-bg-accent animate-pulse" />
      </Show>
    </div>
  )
}

export function SessionAgentsIndicator(props: {
  session: MountedSession
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}) {
  const ctx = useExtension()
  const layout = ctx.layout
  const i18n = useI18n()

  const variant = createMemo(() => props.variant ?? "button")

  const children = createMemo(() => {
    if (!props.session.id) return []

    return props.session.server.data.session.list().filter((info) => info.parentID === props.session.id)
  })

  const subCost = createMemo(() => childrenCost(children()))

  const openAgents = () => {
    if (!props.session.id) return

    layout.toggle("agents:main", props.session)
  }

  const tooltipValue = () => (
    <div class="flex w-[140px] flex-col gap-2">
      <div class="text-12-medium text-text-strong">{ctx.t("view")}</div>
      <AgentsTooltipRow
        name={ctx.t("subagents")}
        value={new Intl.NumberFormat(i18n.locale(), { style: "currency", currency: "USD" }).format(subCost())}
      />
      <AgentsTooltipRow name={ctx.t("count")} value={children().length.toLocaleString(i18n.locale())} />
    </div>
  )

  return (
    <Show when={props.session.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <IconButton
              type="button"
              variant="ghost-muted"
              size="large"
              icon={<AgentsTabIcon session={props.session} />}
              onClick={openAgents}
              aria-label={ctx.t("view")}
            />
          }
        >
          <AgentsTabIcon session={props.session} />
        </Show>
      </Tooltip>
    </Show>
  )
}
