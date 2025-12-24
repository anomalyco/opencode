import { createMemo, Show } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { useSync } from "@/context/sync"
import { useParams } from "@solidjs/router"
import { AssistantMessage } from "@opencode-ai/sdk/v2"

export function SessionContextUsage() {
  const sync = useSync()
  const params = useParams()
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.all.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  return (
    <Show when={context?.()}>
      {(ctx) => (
        <Tooltip
          openDelay={300}
          value={
            <div class="flex flex-col gap-1 p-2">
              <div class="flex justify-between gap-4">
                <span class="text-text-weaker">Tokens</span>
                <span class="text-text-strong">{ctx().tokens}</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-text-weaker">Usage</span>
                <span class="text-text-strong">{ctx().percentage ?? 0}%</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-text-weaker">Cost</span>
                <span class="text-text-strong">{cost()}</span>
              </div>
            </div>
          }
          placement="top"
        >
          <div class="flex items-center gap-1">
            <span class="text-12-medium text-text-weak">{`${ctx().percentage ?? 0}%`}</span>
            <ProgressCircle size={16} strokeWidth={2} percentage={ctx().percentage ?? 0} />
          </div>
        </Tooltip>
      )}
    </Show>
  )
}
