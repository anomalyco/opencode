import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { usePlugin, type SessionContext } from "@opencode/plugin/desktop"
import { contextUsage } from "./usage"
import { toggleContext } from "./toggle"

interface SessionContextUsageProps {
  session: SessionContext
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const plugin = usePlugin()
  const data = props.session.server.data
  const language = plugin.i18n

  const variant = createMemo(() => props.variant ?? "button")
  const messages = createMemo(() => data.session.message.list(props.session.sessionID))
  const info = createMemo(() => data.session.get(props.session.sessionID))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() =>
    contextUsage(
      messages(),
      data.location.model.list(props.session.location) ?? [],
      data.location.provider.list(props.session.location) ?? [],
    ),
  )
  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={{
          "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
          "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
          "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
        }}
      />
    </div>
  )
  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle appearance="compact" percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <ContextTooltipRow name={language.t("context.usage.cost")} value={cost()} />
      <ContextTooltipRow name={language.t("context.usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow
        name={language.t("context.usage.tokens")}
        value={context()?.total.toLocaleString(language.intl()) ?? "0"}
      />
    </div>
  )

  return (
    <Show when={props.session.services}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <IconButton
              type="button"
              variant="ghost-muted"
              size="large"
              icon={compactCircle()}
              onClick={() => toggleContext(props.session)}
              aria-label={language.t("context.usage.view")}
            />
          }
        >
          {circle()}
        </Show>
      </Tooltip>
    </Show>
  )
}
