import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { useExtension, type MountedSession } from "../sdk"
import { catalogModel, syncCatalog } from "./catalog"

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: {
  session: MountedSession
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}) {
  const ctx = useExtension()
  const layout = ctx.layout
  const i18n = useI18n()
  syncCatalog(() => props.session)

  const variant = createMemo(() => props.variant ?? "button")

  const messages = createMemo(() =>
    props.session.id ? props.session.server.data.session.message.list(props.session.id) : [],
  )

  const info = createMemo(() =>
    props.session.id ? props.session.server.data.session.get(props.session.id) : undefined,
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => {
    const message = messages().findLast((item) => item.type === "assistant" && !!item.tokens)

    if (message?.type !== "assistant" || !message.tokens) return
    const model = catalogModel(props.session, message.model)?.model

    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write

    return {
      total,
      usage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })

  const openContext = () => {
    if (!props.session.id) return
    layout.toggle(`${ctx.id}:main`, props.session)
  }

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
      <ContextTooltipRow name={ctx.t("usage.cost")} value={cost()} />
      <ContextTooltipRow name={ctx.t("usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow name={ctx.t("usage.tokens")} value={context()?.total.toLocaleString(i18n.locale()) ?? "0"} />
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
              icon={compactCircle()}
              onClick={openContext}
              aria-label={ctx.t("usage.view")}
            />
          }
        >
          {circle()}
        </Show>
      </Tooltip>
    </Show>
  )
}
