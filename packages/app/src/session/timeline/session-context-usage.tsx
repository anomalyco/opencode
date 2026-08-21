import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMediaQuery } from "@solid-primitives/media"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useData } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useWorkspaceLocation } from "@/context/location"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionTabs } from "@/session/helpers"

interface SessionContextUsageProps {
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

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  args.view.reviewPanel.open(args.view.reviewPanel.opened() ? "other" : "context-button")
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context").then(() => args.tabs.setActive("context"))
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const data = useData()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)
  const { params, tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const variant = createMemo(() => props.variant ?? "button")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    fileBrowser: () => isDesktop() && !!params.id,
  })
  const messages = createMemo(() => (params.id ? data.session.message.list(params.id) : []))
  const info = createMemo(() => (params.id ? data.session.get(params.id) : undefined))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => {
    const message = messages().findLast((item) => item.type === "assistant" && !!item.tokens)
    if (message?.type !== "assistant" || !message.tokens) return
    const model = providers.all().get(message.model.providerID)?.models[message.model.id]
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
  const contextVisible = createMemo(() => view().reviewPanel.opened() && tabState.activeTab() === "context")
  const hasOtherTabs = createMemo(() =>
    tabs()
      .all()
      .some((tab) => tab !== "context" && tab !== "review"),
  )

  const openContext = () => {
    if (!params.id) return

    const sessionView = view()
    if (contextVisible()) {
      tabs().close("context")
      if (sessionView.reviewPanel.source() === "context-button" && !hasOtherTabs()) sessionView.reviewPanel.close()
      return
    }

    openSessionContext({
      view: sessionView,
      layout,
      tabs: tabs(),
    })
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
  const circleV2 = () => (
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
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <IconButton
              type="button"
              variant="ghost-muted"
              size="large"
              icon={circleV2()}
              onClick={openContext}
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
