import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { Tooltip, type TooltipProps } from "@opencode-ai/ui/tooltip"
import { type ProgressCircleProps, ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"
import { Popover } from "@opencode-ai/ui/popover"

import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import {
  estimateSessionContextBreakdown,
  type SessionContextBreakdownKey,
} from "@/components/session/session-context-breakdown"
import { findLast } from "@opencode-ai/core/util/array"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2/client"
import { same } from "@/utils/same"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: TooltipProps["placement"]
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const { params } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const [shown, setShown] = createSignal(false)

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync.data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() => getSessionContextMetrics(messages(), sync.data.provider.all))
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => usd().format(metrics().totalCost))
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return { all: all.length, user, assistant }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(userMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const breakdown = createMemo(() => {
    const c = context()
    if (!c?.input) return []
    return estimateSessionContextBreakdown({
      messages: messages(),
      parts: sync.data.part as Record<string, import("@opencode-ai/sdk/v2/client").Part[] | undefined>,
      input: c.input,
      systemPrompt: systemPrompt(),
    })
  })

  const breakdownLabel = (key: SessionContextBreakdownKey) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "user") return language.t("context.breakdown.user")
    if (key === "assistant") return language.t("context.breakdown.assistant")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }

  const status = createMemo((): ProgressCircleProps["status"] => {
    const usage = context()?.usage ?? 0
    if (usage >= 80) return "critical"
    if (usage >= 50) return "warning"
    if (usage > 0) return "success"
    return "default"
  })

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.usage ?? 0} status={status()} />
    </div>
  )

  const tooltipValue = () => (
    <div>
      <Show when={context()}>
        {(ctx) => (
          <>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().total.toLocaleString(language.intl())}</span>
              <span class="text-text-invert-base">{language.t("context.usage.tokens")}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
              <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
            </div>
          </>
        )}
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
      </div>
    </div>
  )

  const stats = createMemo(() => [
    { label: "context.stats.provider", value: context()?.providerLabel ?? "—" },
    { label: "context.stats.model", value: context()?.modelLabel ?? "—" },
    { label: "context.stats.limit", value: formatter().number(context()?.limit) },
    { label: "context.stats.totalTokens", value: formatter().number(context()?.total) },
    { label: "context.stats.usage", value: formatter().percent(context()?.usage) },
    { label: "context.stats.inputTokens", value: formatter().number(context()?.input) },
    { label: "context.stats.outputTokens", value: formatter().number(context()?.output) },
    { label: "context.stats.reasoningTokens", value: formatter().number(context()?.reasoning) },
    {
      label: "context.stats.cacheTokens",
      value: `${formatter().number(context()?.cacheRead)} / ${formatter().number(context()?.cacheWrite)}`,
    },
    { label: "context.stats.messages", value: counts().all.toLocaleString(language.intl()) },
    { label: "context.stats.totalCost", value: cost() },
  ])

  const popoverContent = () => (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-x-5 gap-y-2.5">
        <For each={stats()}>
          {(stat) => (
            <>
              <div class="text-13-regular text-text-weak">{language.t(stat.label as Parameters<typeof language.t>[0])}</div>
              <div class="text-13-medium text-text-strong text-right truncate">{stat.value}</div>
            </>
          )}
        </For>
      </div>

      <Show when={breakdown().length > 0}>
        <div class="flex flex-col gap-2 pt-3 border-t border-border-weak-base">
          <div class="text-13-regular text-text-weak">{language.t("context.breakdown.title")}</div>
          <div class="h-2.5 w-full rounded-full bg-surface-base/60 overflow-hidden flex">
            <For each={breakdown()}>
              {(segment) => (
                <div
                  class="h-full"
                  style={{
                    width: `${segment.width}%`,
                    "background-color": BREAKDOWN_COLOR[segment.key],
                  }}
                />
              )}
            </For>
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <For each={breakdown()}>
              {(segment) => (
                <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
                  <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                  <div>{breakdownLabel(segment.key)}</div>
                  <div class="text-text-weaker">{segment.percent.toLocaleString(language.intl())}%</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )

  return (
    <Show when={params.id}>
      <Switch>
        <Match when={variant() === "indicator"}>
          <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
            {circle()}
          </Tooltip>
        </Match>
        <Match when={true}>
          <Popover
            open={shown()}
            onOpenChange={setShown}
            triggerAs={Button}
            triggerProps={{
              variant: "ghost",
              class: "size-6",
              "aria-label": language.t("context.usage.view"),
            }}
            trigger={circle()}
            class="[&_[data-slot=popover-body]]:p-0 w-[min(380px,calc(100vw-40px))] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
            style={{ "box-shadow": "none", "background-color": "transparent", "border": "none", "backdrop-filter": "none", "-webkit-backdrop-filter": "none" }}
            gutter={4}
            placement={props.placement === "bottom" ? "bottom-end" : "top-end"}
          >
            <div
              class="w-[min(380px,calc(100vw-40px))] rounded-xl overflow-hidden border border-border-weak-base shadow-[var(--shadow-lg-border-base)]"
              style={{
                "background-color":
                  platform.platform === "desktop" && platform.os === "windows"
                    ? "var(--surface-raised-stronger-non-alpha)"
                    : "color-mix(in srgb, var(--background-stronger) 70%, transparent)",
                "backdrop-filter":
                  platform.platform === "desktop" && platform.os === "windows" ? "none" : "blur(40px) saturate(150%)",
                "-webkit-backdrop-filter":
                  platform.platform === "desktop" && platform.os === "windows" ? "none" : "blur(40px) saturate(150%)",
              }}
            >
              <div class="px-4 py-3 border-b border-border-weak-base flex items-center gap-2">
                {circle()}
                <span class="text-14-medium text-text-strong">{language.t("context.usage.view")}</span>
              </div>
              <div class="px-4 py-4">{popoverContent()}</div>
            </div>
          </Popover>
        </Match>
      </Switch>
    </Show>
  )
}
