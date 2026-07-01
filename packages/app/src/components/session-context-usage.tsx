import { Match, Show, Switch, createMemo } from "solid-js"
import { Tooltip, type TooltipProps } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { ProgressCircleV2 } from "@opencode-ai/ui/v2/progress-circle-v2"
import { Button } from "@opencode-ai/ui/button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { getSessionContext, getSessionTokenTotal } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  buttonAppearance?: "default" | "v2"
  placement?: TooltipProps["placement"]
}

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  args.view.reviewPanel.open(args.view.reviewPanel.opened() ? "other" : "context-button")
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params, tabs, view } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const buttonAppearance = createMemo(() => props.buttonAppearance ?? "default")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const tokens = createMemo(() => info()?.tokens)
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
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={
          variant() === "indicator"
            ? {
                "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
                "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
                "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
              }
            : undefined
        }
      />
    </div>
  )
  const circleV2 = () => (
    <div class="flex items-center justify-center">
      <ProgressCircleV2 percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div>
      <Show when={tokens()}>
        {(value) => (
          <div class="flex items-center gap-2">
            <span class="text-text-invert-strong">
              {getSessionTokenTotal(value())?.toLocaleString(language.intl())}
            </span>
            <span class="text-text-invert-base">{language.t("context.usage.tokens")}</span>
          </div>
        )}
      </Show>
      <Show when={context()}>
        {(ctx) => (
          <div class="flex items-center gap-2">
            <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
            <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
          </div>
        )}
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
      </div>
    </div>
  )

  return (
    <Show when={params.id}>
      <Switch>
        <Match when={variant() === "indicator"}>{circle()}</Match>
        <Match when={buttonAppearance() === "v2"}>
          <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
              icon={circleV2()}
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            />
          </Tooltip>
        </Match>
        <Match when={true}>
          <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
            <Button
              type="button"
              variant="ghost"
              class="size-6"
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            >
              {circle()}
            </Button>
          </Tooltip>
        </Match>
      </Switch>
    </Show>
  )
}
