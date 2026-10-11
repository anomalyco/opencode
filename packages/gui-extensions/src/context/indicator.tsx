import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Button } from "@opencode/ui/button"
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

  const tokens = createMemo(() =>
    new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 0 })
      .format(context()?.total ?? 0)
      .toLocaleLowerCase(i18n.locale()),
  )

  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })

  const showCost = createMemo(() => {
    if ((info()?.cost ?? 0) > 0) return true
    const ref = info()?.model ?? messages().findLast((item) => item.type === "assistant")?.model
    const model = ref ? catalogModel(props.session, ref)?.model : undefined

    if (!model) return true

    return model.cost.some((cost) => cost.input > 0 || cost.output > 0 || cost.cache.read > 0 || cost.cache.write > 0)
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
      <ProgressCircle appearance="compact" size={16} percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <Show when={showCost()}>
        <ContextTooltipRow name={ctx.t("usage.cost")} value={cost()} />
      </Show>
      <ContextTooltipRow name={ctx.t("usage.usage")} value={`${context()?.usage ?? 0}%`} />
      <ContextTooltipRow name={ctx.t("usage.tokens")} value={context()?.total.toLocaleString(i18n.locale()) ?? "0"} />
    </div>
  )

  return (
    <Show when={props.session.id}>
      <Tooltip
        value={variant() === "indicator" ? tooltipValue() : ctx.t("usage.toggle")}
        placement={props.placement ?? "top"}
      >
        <Show
          when={variant() === "indicator"}
          fallback={
            <Button
              type="button"
              variant="ghost-muted"
              class="group shrink-0"
              style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
              onClick={openContext}
              aria-expanded={layout.state(`${ctx.id}:main`, props.session) === "visible"}
              aria-label={ctx.t("usage.toggle")}
            >
              <span class="flex items-center gap-2 whitespace-nowrap group-active:text-v2-text-text-muted">
                {compactCircle()}
                <span>{tokens()}</span>
                <Show when={showCost()}>
                  <span aria-hidden="true" class="flex w-1.5 shrink-0 items-center justify-center">
                    ·
                  </span>
                  <span>{cost()}</span>
                </Show>
              </span>
            </Button>
          }
        >
          {circle()}
        </Show>
      </Tooltip>
    </Show>
  )
}
