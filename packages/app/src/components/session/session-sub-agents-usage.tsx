import { Match, Switch, createMemo, type ComponentProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useSubAgents } from "@/context/sub-agents"
import { createSessionContextFormatter } from "./session-context-format"

interface SessionSubAgentsUsageProps {
  variant?: "indicator" | "button"
  placement?: ComponentProps<typeof TooltipV2>["placement"]
}

export function SessionSubAgentsUsage(props: SessionSubAgentsUsageProps) {
  const { children, agentsBusy, totalCost } = useSubAgents()
  const language = useLanguage()

  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <div class="flex min-w-0 items-center gap-4">
        <span class="shrink-0 text-v2-text-text-muted">{language.t("session.agents.costTotal")}</span>
        <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{formatter().cost(totalCost())}</span>
      </div>
      <div class="flex min-w-0 items-center gap-4">
        <span class="shrink-0 text-v2-text-text-muted">{language.t("session.agents.count")}</span>
        <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{children().length}</span>
      </div>
    </div>
  )

  const indicator = () => (
    <div class="relative size-4">
      <Icon name="terminal" size="small" />
      <span
        classList={{
          "absolute -top-1 -right-1 size-2 rounded-full bg-green-500 animate-pulse": agentsBusy(),
          hidden: !agentsBusy(),
        }}
      />
    </div>
  )

  return (
    <TooltipV2 value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
      <Switch>
        <Match when={props.variant === "indicator"}>{indicator()}</Match>
        <Match when={true}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            icon={indicator()}
            aria-label={language.t("session.tab.agents")}
          />
        </Match>
      </Switch>
    </TooltipV2>
  )
}
