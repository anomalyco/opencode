import { createMemo, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { useSync } from "@/context/sync"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"

export function DockStatusPopover() {
  const sync = useSync()
  const params = useParams()
  const local = useLocal()
  const language = useLanguage()

  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const metrics = createMemo(() => getSessionContextMetrics(messages(), sync.data.provider.all))
  const context = createMemo(() => metrics().context)

  const model = createMemo(() => local.model.current())

  const fallbacks = createMemo(() => {
    const m = model()
    if (!m?.fallbacks?.length) return []
    return m.fallbacks.flatMap((f) => {
      const p = sync.data.provider.all.find((x) => x.id === f.providerID)
      if (!p) return []
      const fm = p.models[f.modelID]
      return [{ provider: p, model: fm, providerID: f.providerID, modelID: f.modelID }]
    })
  })

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.locale(), {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }),
  )

  const cost = createMemo(() => usd().format(metrics().totalCost))

  const usagePct = createMemo(() => context()?.usage ?? 0)

  // colour band: green → yellow → red
  const barColor = createMemo(() => {
    const pct = usagePct()
    if (pct >= 90) return "bg-icon-critical-base"
    if (pct >= 70) return "bg-icon-warning-base"
    return "bg-icon-success-base"
  })

  return (
    <Show when={params.id}>
      <Popover
        placement="top-end"
        gutter={8}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "normal",
          style: { height: "28px" },
          class: "size-7 p-0 flex items-center justify-center",
          "aria-label": "Session status",
        }}
        trigger={<Icon name="info" class="size-[18px] text-icon-weak" />}
      >
        <div class="w-64 p-3 flex flex-col gap-3">
          {/* Active model */}
          <Show when={model()}>
            {(m) => (
              <div class="flex flex-col gap-1">
                <span class="text-11-medium text-text-weak uppercase tracking-wide">Active model</span>
                <div class="flex items-center gap-1.5">
                  <Show when={m().provider?.id}>
                    <ProviderIcon
                      id={m().provider.id as IconName}
                      class="size-4 shrink-0 text-icon-base"
                    />
                  </Show>
                  <span class="text-13-medium text-text-strong truncate">
                    {m().provider?.name ?? m().providerID}
                  </span>
                  <span class="text-icon-weak">·</span>
                  <span class="text-13-regular text-text-base truncate">{m().name}</span>
                </div>
              </div>
            )}
          </Show>

          {/* Context usage */}
          <Show when={context()}>
            {(ctx) => (
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-11-medium text-text-weak uppercase tracking-wide">Context</span>
                  <span class="text-12-regular text-text-base">
                    {ctx().total.toLocaleString(language.locale())}
                    <Show when={ctx().limit}>
                      {(lim) => (
                        <span class="text-text-weak"> / {lim().toLocaleString(language.locale())}</span>
                      )}
                    </Show>
                    <span class="text-text-weak"> tok</span>
                  </span>
                </div>
                {/* progress bar */}
                <div class="h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
                  <div
                    class={`h-full rounded-full transition-all ${barColor()}`}
                    style={{ width: `${Math.min(usagePct(), 100)}%` }}
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-11-regular text-text-weak">{usagePct()}% used</span>
                  <span class="text-11-regular text-text-weak">{cost()}</span>
                </div>
              </div>
            )}
          </Show>

          {/* Fallback chain */}
          <Show when={fallbacks().length > 0}>
            <div class="flex flex-col gap-1">
              <span class="text-11-medium text-text-weak uppercase tracking-wide">Fallback chain</span>
              <div class="flex flex-col gap-0.5">
                <For each={fallbacks()}>
                  {(fb, i) => (
                    <div class="flex items-center gap-1.5">
                      <span class="text-11-regular text-text-weak w-3 text-right shrink-0">{i() + 1}.</span>
                      <Show when={fb.provider?.id}>
                        <ProviderIcon
                          id={fb.provider.id as IconName}
                          class="size-3.5 shrink-0 text-icon-weak"
                        />
                      </Show>
                      <span class="text-12-regular text-text-base truncate">
                        {fb.provider?.name ?? fb.providerID}
                      </span>
                      <span class="text-icon-weak">·</span>
                      <span class="text-12-regular text-text-weak truncate">
                        {fb.model?.name ?? fb.modelID}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* No data state */}
          <Show when={!context() && !model()}>
            <span class="text-12-regular text-text-weak text-center py-1">No active session</span>
          </Show>
        </div>
      </Popover>
    </Show>
  )
}
