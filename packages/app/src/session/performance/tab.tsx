import { createMemo, createEffect, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useData } from "@/runtime/server/current"
import { same } from "@/runtime/persistence/equality"
import { ScrollView } from "@opencode/ui/scroll-view"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { useProviders } from "@/providers/catalog/providers"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSessionLayout } from "@/session/session-layout"
import { getSessionPerformance } from "./metrics"
import { createPerformanceFormatter } from "./format"

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="text-12-medium text-text-strong">{props.value}</div>
    </div>
  )
}

const emptyMessages: SessionMessageInfo[] = []
const rowClass = "grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] gap-x-4 items-center text-12-regular"

export function SessionPerformanceTab() {
  const data = useData()
  const language = useLanguage()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)
  const { params, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? data.session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return data.session.message.list(id)
    },
    emptyMessages,
    { equals: same },
  )

  const perf = createMemo(() =>
    getSessionPerformance({
      messages: messages(),
      revert: info()?.revert?.messageID,
    }),
  )
  const formatter = createMemo(() => createPerformanceFormatter(language.intl()))
  const modelLabel = (message: SessionMessageAssistant) =>
    providers.all().get(message.model.providerID)?.models[message.model.id]?.name ?? message.model.id
  const tps = (value: number | undefined) =>
    value === undefined
      ? "—"
      : language.t("performance.unit.tps", { value: Math.round(value).toLocaleString(language.intl()) })

  const stats = [
    { label: "performance.stats.ttftMedian", value: () => formatter().duration(perf().summary.ttftMedian) },
    { label: "performance.stats.tps", value: () => tps(perf().summary.tps) },
    { label: "performance.stats.wall", value: () => formatter().duration(perf().summary.wall) },
    { label: "performance.stats.calls", value: () => perf().summary.calls.toLocaleString(language.intl()) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined
  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("performance")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      view().setScroll("performance", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-4 pt-4 pb-6 flex flex-col gap-6 md:px-6 md:pb-10 md:gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats}>
            {(stat) => <Stat label={language.t(stat.label as Parameters<typeof language.t>[0])} value={stat.value()} />}
          </For>
        </div>

        <Show
          when={perf().rows.length > 0}
          fallback={<div class="text-12-regular text-text-weak">{language.t("performance.empty")}</div>}
        >
          <div class="flex flex-col gap-3">
            <div class={`${rowClass} text-11-regular text-text-weak`}>
              <div>{language.t("performance.column.time")}</div>
              <div>{language.t("performance.column.model")}</div>
              <div class="text-right tabular-nums">{language.t("performance.column.ttft")}</div>
              <div class="text-right tabular-nums">{language.t("performance.column.tps")}</div>
              <div class="text-right tabular-nums">{language.t("performance.column.wall")}</div>
              <div class="text-right tabular-nums">{language.t("performance.column.tokens")}</div>
            </div>
            <For each={perf().rows}>
              {(row) => (
                <div class={rowClass}>
                  <div class="tabular-nums">{formatter().clock(row.message.time.created)}</div>
                  <div class="min-w-0 flex items-center gap-2">
                    <div class="truncate">{modelLabel(row.message)}</div>
                    <Show when={row.message.error}>
                      <span class="text-11-regular text-text-weak">{language.t("performance.badge.error")}</span>
                    </Show>
                    <Show when={!row.message.time.completed}>
                      <span class="text-11-regular text-text-weak">{language.t("performance.badge.running")}</span>
                    </Show>
                  </div>
                  <div class="text-right tabular-nums">{formatter().duration(row.ttft)}</div>
                  <div class="text-right tabular-nums">{tps(row.tps)}</div>
                  <div class="text-right tabular-nums">{formatter().duration(row.wall)}</div>
                  <div class="text-right tabular-nums">{row.tokens.toLocaleString(language.intl())}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </ScrollView>
  )
}
