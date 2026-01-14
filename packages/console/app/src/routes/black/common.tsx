import { Match, Switch } from "solid-js"

export const plans = [
  { id: "20", multiplier: null },
  { id: "100", multiplier: "6x more usage than Black 20" },
  { id: "200", multiplier: "21x more usage than Black 20" },
] as const

export type PlanID = (typeof plans)[number]["id"]
export type Plan = (typeof plans)[number]

export function PlanIcon(props: { plan: string }) {
  return (
    <Switch>
      <Match when={props.plan === "20"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </Match>
      <Match when={props.plan === "100"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </Match>
      <Match when={props.plan === "200"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="10" y="2" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="18" y="2" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="2" y="10" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="10" y="10" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="18" y="10" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="2" y="18" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="10" y="18" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="18" y="18" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
        </svg>
      </Match>
    </Switch>
  )
}
