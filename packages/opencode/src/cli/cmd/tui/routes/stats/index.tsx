import { batch, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { RGBA, TextAttributes } from "@opentui/core"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import * as Clipboard from "@tui/util/clipboard"
import {
  type DateRange,
  DATE_RANGES,
  filterByRange,
  favoriteModel,
  distinctSessions,
  activeDays,
  mostActiveDay,
  longestSessionMs,
  streaks,
  totalTokens,
  perModelShare,
  formatCompact,
  formatDuration,
  formatPct,
  formatShortDate,
  compareToWork,
  formatMultiplier,
} from "@tui/util/usage-stats"
import type { UsageRecord } from "@tui/util/usage-stats"
import { recordsFromMessages, displayModel } from "./data"
import { Heatmap } from "./heatmap"
import { Chart } from "./chart"
import { summarizeStats } from "./summary"
import { modelColor } from "./palette"

type SubTab = "overview" | "models"

const TAB_LABELS: { id: "status" | "config" | "usage" | "stats"; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "config", label: "Config" },
  { id: "usage", label: "Usage" },
  { id: "stats", label: "Stats" },
]

export function Stats() {
  const route = useRoute()
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dimensions = useTerminalDimensions()

  const [store, setStore] = createStore<{
    range: DateRange
    sub: SubTab
    messages: Record<string, UsageRecord[]>
    loading: boolean
    loaded: number
    total: number
  }>({
    range: "all",
    sub: "overview",
    messages: {},
    loading: true,
    loaded: 0,
    total: 0,
  })

  // Mount: fetch the full session history (start=0) so All-time is accurate,
  // then lazily load each session's messages in small parallel batches.
  onMount(async () => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })

    try {
      const listResult = await sdk.client.session.list({ start: 0 })
      if (cancelled) return
      const sessions = (listResult.data ?? []).filter((s) => !s.parentID)
      setStore("total", sessions.length)

      const BATCH = 8
      for (let i = 0; i < sessions.length; i += BATCH) {
        if (cancelled) return
        const slice = sessions.slice(i, i + BATCH)
        await Promise.all(
          slice.map(async (session) => {
            try {
              // Prefer already-synced messages when available to avoid a refetch.
              const existing = sync.data.message[session.id]
              const messages = existing ?? (await fetchSessionMessages(sdk, session.id))
              if (cancelled) return
              const records = recordsFromMessages(session, messages ?? [])
              batch(() => {
                setStore("messages", session.id, records)
                setStore("loaded", (n) => n + 1)
              })
            } catch {
              batch(() => {
                setStore("messages", session.id, [])
                setStore("loaded", (n) => n + 1)
              })
            }
          }),
        )
      }
    } catch {
      toast.show({ variant: "error", message: "Failed to load usage stats" })
    } finally {
      if (!cancelled) setStore("loading", false)
    }
  })

  const allRecords = createMemo(() => {
    const out: UsageRecord[] = []
    for (const list of Object.values(store.messages)) out.push(...list)
    return out
  })

  const filtered = createMemo(() => filterByRange(allRecords(), store.range))

  const stats = createMemo(() => {
    const recs = filtered()
    const total = totalTokens(recs)
    const days = activeDays(recs)
    const s = streaks(recs)
    return {
      total,
      favorite: favoriteModel(recs),
      sessions: distinctSessions(recs),
      active: days.length,
      most: mostActiveDay(recs),
      longest: longestSessionMs(recs),
      longestStreak: s.longest,
      currentStreak: s.current,
      comparison: compareToWork(total),
      perModel: perModelShare(recs),
    }
  })

  const cycleRange = () => {
    const idx = DATE_RANGES.findIndex((r) => r.id === store.range)
    const next = DATE_RANGES[(idx + 1) % DATE_RANGES.length]
    setStore("range", next.id)
  }

  const copySummary = async () => {
    const text = summarizeStats({ range: store.range, records: filtered() })
    try {
      await Clipboard.copy(text)
      toast.show({ variant: "info", message: "Copied stats summary to clipboard" })
    } catch {
      toast.show({ variant: "error", message: "Failed to copy to clipboard" })
    }
  }

  useKeyboard((evt) => {
    if (route.data.type !== "stats") return
    if (evt.defaultPrevented) return
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      route.navigate({ type: "home" })
      evt.preventDefault()
      return
    }
    if (evt.ctrl && evt.name === "s") {
      void copySummary()
      evt.preventDefault()
      return
    }
    if (!evt.ctrl && !evt.meta && evt.name === "r") {
      cycleRange()
      evt.preventDefault()
      return
    }
    if (evt.name === "left" || evt.name === "h") {
      setStore("sub", "overview")
      evt.preventDefault()
      return
    }
    if (evt.name === "right" || evt.name === "l") {
      setStore("sub", "models")
      evt.preventDefault()
      return
    }
    if (evt.name === "tab" || evt.name === "up" || evt.name === "down") {
      setStore("sub", store.sub === "overview" ? "models" : "overview")
      evt.preventDefault()
    }
  })

  const selectedFg = createMemo(() => contrastingFg(theme.primary))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <TopTabs active="stats" />
      <SubTabs
        active={store.sub}
        onSelect={(id) => setStore("sub", id)}
      />

      <box flexDirection="row" paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0}>
        <For each={DATE_RANGES}>
          {(item) => {
            const active = () => store.range === item.id
            return (
              <box
                marginRight={2}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : undefined}
                onMouseUp={() => setStore("range", item.id)}
              >
                <text
                  fg={active() ? selectedFg() : theme.textMuted}
                  attributes={active() ? TextAttributes.BOLD : undefined}
                >
                  {item.label}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <box flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Show
          when={!store.loading || Object.keys(store.messages).length > 0}
          fallback={<Loading loaded={store.loaded} total={store.total} />}
        >
          <Show
            when={allRecords().length > 0}
            fallback={<EmptyState message="No usage data yet. Start a session to see stats." />}
          >
            <Show when={store.sub === "overview"}>
              <Overview records={allRecords()} stats={stats()} />
            </Show>
            <Show when={store.sub === "models"}>
              <Models records={filtered()} stats={stats()} range={store.range} />
            </Show>
          </Show>
        </Show>
      </box>

      <Footer
        loading={store.loading}
        loaded={store.loaded}
        total={store.total}
      />
    </box>
  )
}

/** Picks black or white text for good contrast against the given background. */
function contrastingFg(bg: RGBA): RGBA {
  const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b
  return lum > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

async function fetchSessionMessages(sdk: ReturnType<typeof useSDK>, sessionID: string) {
  const result = await sdk.client.session.messages({ sessionID, limit: 1000 })
  return (result.data ?? []).map((x) => x.info)
}

function TopTabs(props: { active: "status" | "config" | "usage" | "stats" }) {
  const { theme } = useTheme()
  const selectedFg = () => contrastingFg(theme.primary)
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="row" flexShrink={0}>
      <For each={TAB_LABELS}>
        {(tab) => {
          const active = tab.id === props.active
          return (
            <box
              marginRight={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={active ? theme.primary : undefined}
            >
              <text
                fg={active ? selectedFg() : theme.textMuted}
                attributes={active ? TextAttributes.BOLD : undefined}
              >
                {tab.label}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function SubTabs(props: { active: SubTab; onSelect: (id: SubTab) => void }) {
  const { theme } = useTheme()
  const items: { id: SubTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "models", label: "Models" },
  ]
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="row" flexShrink={0}>
      <For each={items}>
        {(item) => {
          const active = () => props.active === item.id
          return (
            <box
              marginRight={2}
              paddingLeft={1}
              paddingRight={1}
              borderColor={active() ? theme.primary : theme.borderSubtle}
              border={active() ? ["bottom"] : []}
              onMouseUp={() => props.onSelect(item.id)}
            >
              <text fg={active() ? theme.text : theme.textMuted} attributes={active() ? TextAttributes.BOLD : undefined}>
                {item.label}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function Loading(props: { loaded: number; total: number }) {
  const { theme } = useTheme()
  return (
    <box alignItems="flex-start" paddingTop={1}>
      <text fg={theme.textMuted}>
        Loading stats… {props.total > 0 ? `${props.loaded}/${props.total} sessions` : ""}
      </text>
    </box>
  )
}

function EmptyState(props: { message: string }) {
  const { theme } = useTheme()
  return (
    <box alignItems="flex-start" paddingTop={1}>
      <text fg={theme.textMuted}>{props.message}</text>
    </box>
  )
}

function Footer(props: { loading: boolean; loaded: number; total: number }) {
  const { theme } = useTheme()
  return (
    <box
      flexShrink={0}
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      justifyContent="space-between"
    >
      <text fg={theme.textMuted}>↑ tabs · r to cycle dates · ctrl+s to copy</text>
      <Show when={props.loading && props.total > 0}>
        <text fg={theme.textMuted}>
          loading {props.loaded}/{props.total}
        </text>
      </Show>
    </box>
  )
}

/* ---------- Overview tab ---------- */

function Overview(props: {
  records: UsageRecord[]
  stats: {
    total: number
    favorite: string | undefined
    sessions: number
    active: number
    most: { day: string; total: number } | undefined
    longest: number
    longestStreak: number
    currentStreak: number
    comparison: { name: string; multiplier: number } | undefined
  }
}) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      <Heatmap records={props.records} />

      <box flexDirection="row" gap={6}>
        <box flexGrow={1} minWidth={28}>
          <KpiRow label="Favorite model" value={props.stats.favorite ? displayModel(props.stats.favorite) : "—"} />
          <KpiRow label="Sessions" value={`${props.stats.sessions}`} />
          <KpiRow label="Active days" value={`${props.stats.active}`} />
          <KpiRow
            label="Most active day"
            value={
              props.stats.most
                ? `${formatShortDate(props.stats.most.day)} (${formatCompact(props.stats.most.total)})`
                : "—"
            }
          />
        </box>
        <box flexGrow={1} minWidth={28}>
          <KpiRow label="Total tokens" value={formatCompact(props.stats.total)} />
          <KpiRow label="Longest session" value={formatDuration(props.stats.longest)} />
          <KpiRow label="Longest streak" value={`${props.stats.longestStreak}d`} />
          <KpiRow label="Current streak" value={`${props.stats.currentStreak}d`} />
        </box>
      </box>

      <Show when={props.stats.comparison}>
        {(cmp) => (
          <text fg={theme.textMuted}>
            You've used <span style={{ fg: theme.text }}>~{formatMultiplier(cmp().multiplier)}</span>{" "}
            more tokens than {cmp().name}
          </text>
        )}
      </Show>
    </box>
  )
}

function KpiRow(props: { label: string; value: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingRight={2}>
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.value}
      </text>
    </box>
  )
}

/* ---------- Models tab ---------- */

function Models(props: {
  records: UsageRecord[]
  stats: {
    perModel: { model: string; input: number; output: number; total: number; share: number }[]
  }
  range: DateRange
}) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Tokens per Day
      </text>
      <Chart records={props.records} range={props.range} />
      <ModelBreakdown models={props.stats.perModel} />
    </box>
  )
}

function ModelBreakdown(props: {
  models: { model: string; input: number; output: number; total: number; share: number }[]
}) {
  const { theme } = useTheme()
  return (
    <Show
      when={props.models.length > 0}
      fallback={<text fg={theme.textMuted}>No model usage in this range.</text>}
    >
      <box flexDirection="column" gap={0}>
        <For each={props.models}>
          {(m, i) => {
            const color = modelColor(m.model, i())
            return (
              <box flexDirection="row" paddingTop={0} gap={2}>
                <box flexDirection="column" flexShrink={0} minWidth={32}>
                  <box flexDirection="row" gap={1}>
                    <text fg={color}>●</text>
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      {displayModel(m.model)}
                    </text>
                    <text fg={theme.textMuted}>({formatPct(m.share)})</text>
                  </box>
                  <text fg={theme.textMuted}>
                    <span>In: </span>
                    <span style={{ fg: theme.text }}>{formatCompact(m.input)}</span>
                    <span>   Out: </span>
                    <span style={{ fg: theme.text }}>{formatCompact(m.output)}</span>
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

