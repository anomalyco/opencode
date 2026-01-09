import { Match, Show, Switch, createMemo } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"
import { useParams } from "@solidjs/router"
import { AssistantMessage } from "@opencode-ai/sdk/v2/client"

import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const params = useParams()
  const layout = useLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const view = createMemo(() => layout.view(sessionKey()))
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => {
      if (x.role !== "assistant") return false
      const total = x.tokens.input + x.tokens.output + x.tokens.reasoning + x.tokens.cache.read + x.tokens.cache.write
      return total > 0
    }) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.all.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const openContext = () => {
    if (!params.id) return
    view().reviewPanel.open()
    tabs().open("context")
    tabs().setActive("context")
  }

  const circle = () => (
    <div class="p-1">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.percentage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div>
      <Show when={context()}>
        {(ctx) => (
          <>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().tokens}</span>
              <span class="text-text-invert-base">Tokens</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().percentage ?? 0}%</span>
              <span class="text-text-invert-base">Usage</span>
            </div>
          </>
        )}
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">Cost</span>
      </div>
      <Show when={variant() === "button"}>
        <div class="text-11-regular text-text-invert-base mt-1">Click to view context</div>
      </Show>
    </div>
  )

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement="top">
        <Switch>
          <Match when={variant() === "indicator"}>{circle()}</Match>
          <Match when={true}>
            <Button type="button" variant="ghost" class="size-6" onClick={openContext}>
              {circle()}
            </Button>
          </Match>
        </Switch>
      </Tooltip>
    </Show>
  )
}
