import { For } from "solid-js"
import { useI18n } from "../context/i18n"

export type Period = "weekly" | "daily"

// The period every bar chart opens on.
export const DEFAULT_PERIOD: Period = "daily"

export function PeriodToggle(props: { value: Period; onChange: (period: Period) => void; label: string }) {
  const i18n = useI18n()
  return (
    <div data-component="usage-filter" data-variant="range" role="group" aria-label={props.label}>
      <For each={["daily", "weekly"] as const}>
        {(period) => (
          <button
            type="button"
            data-active={props.value === period ? "true" : undefined}
            aria-pressed={props.value === period}
            onClick={() => props.onChange(period)}
          >
            {i18n.t(period === "weekly" ? "chart.period.weekly" : "chart.period.daily")}
          </button>
        )}
      </For>
    </div>
  )
}
