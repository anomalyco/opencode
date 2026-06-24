/**
 * Monitor / Health tab.
 *
 * Composite score ring (4 weighted components) + gauge strip. The score
 * formula is documented inline and shown beneath the ring so users
 * always know what they are looking at.
 */

import { createResource, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { createMonitorClient } from "@/utils/monitor-sdk"
import type { Health } from "@/utils/monitor-schema"

type ComponentDef = { id: keyof Health["components"]; key: string; weight: number; invert?: boolean }
const COMPONENTS: readonly ComponentDef[] = [
  { id: "success_rate", key: "monitor.health.success_rate", weight: 0.4 },
  { id: "cache_hit_rate", key: "monitor.health.cache_hit_rate", weight: 0.25 },
  { id: "error_rate", key: "monitor.health.error_rate", weight: 0.25, invert: true },
  { id: "heap_pct", key: "monitor.health.heap_pct", weight: 0.1, invert: true },
] as const

function Gauge(props: { value: number; label: string; invert?: boolean }) {
  const v = () => Math.max(0, Math.min(100, props.value))
  const color = () => {
    if (props.invert) {
      if (v() < 25) return "stroke-icon-success-base"
      if (v() < 60) return "stroke-icon-warning-base"
      return "stroke-icon-critical-base"
    }
    if (v() > 75) return "stroke-icon-success-base"
    if (v() > 40) return "stroke-icon-warning-base"
    return "stroke-icon-critical-base"
  }
  return (
    <div class="flex flex-col items-center gap-1">
      <svg width="80" height="48" viewBox="0 0 80 48" aria-label={props.label}>
        <path
          d="M 8 44 A 32 32 0 0 1 72 44"
          fill="none"
          stroke="currentColor"
          class="text-border-weak-base"
          stroke-width="6"
          stroke-linecap="round"
        />
        <path
          d="M 8 44 A 32 32 0 0 1 72 44"
          fill="none"
          class={color()}
          stroke-width="6"
          stroke-linecap="round"
          stroke-dasharray={`${(v() / 100) * 100.5} 100.5`}
        />
      </svg>
      <span class="text-12-medium text-text-base">{v().toFixed(0)}</span>
      <span class="text-11-regular text-text-weak">{props.label}</span>
    </div>
  )
}

function ScoreRing(props: { score: number }) {
  const score = () => Math.max(0, Math.min(100, props.score))
  const r = 52
  const c = 2 * Math.PI * r
  const offset = () => c - (score() / 100) * c
  const color = () =>
    score() > 75
      ? "stroke-icon-success-base"
      : score() > 40
        ? "stroke-icon-warning-base"
        : "stroke-icon-critical-base"

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="currentColor"
        class="text-border-weak-base"
        stroke-width="10"
      />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        class={color()}
        stroke-width="10"
        stroke-linecap="round"
        stroke-dasharray={String(c)}
        stroke-dashoffset={String(offset())}
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="70"
        text-anchor="middle"
        dominant-baseline="central"
        class="fill-text-strong"
        font-size="28"
        font-weight="600"
      >
        {score().toFixed(0)}
      </text>
    </svg>
  )
}

export function MonitorHealth(props: { baseUrl: string }) {
  const language = useLanguage()
  const client = createMonitorClient({ baseUrl: props.baseUrl })
  const [health] = createResource(() => client.health())

  return (
    <div class="flex flex-col gap-6">
      <header class="flex items-center justify-between">
        <h2 class="text-14-medium text-text-base">{language.t("monitor.health.title")}</h2>
        <span class="text-11-regular text-text-weak font-mono">{language.t("monitor.health.formula")}</span>
      </header>
      <Show
        when={health()}
        fallback={<p class="text-text-weak text-13-regular">{language.t("monitor.common.loading")}</p>}
      >
        {(h) => (
          <div class="flex flex-wrap gap-8 items-center">
            <ScoreRing score={h().score} />
            <div class="flex flex-wrap gap-4">
              {COMPONENTS.map((c) => (
                <Gauge
                  value={h().components[c.id]}
                  label={language.t(c.key)}
                  invert={c.invert}
                />
              ))}
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
