import { Match, Switch } from "solid-js"

export const plans = [
  { id: "20", multiplier: null },
  { id: "100", multiplier: "5x more usage than Black 20" },
  { id: "200", multiplier: "20x more usage than Black 20" },
] as const

export type PlanID = (typeof plans)[number]["id"]
export type Plan = (typeof plans)[number]

export function PlanIcon(props: { plan: string }) {
  return (
    <Switch>
      <Match when={props.plan === "20"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Black 20 plan</title>
          <rect x="0.5" y="0.5" width="23" height="23" stroke="currentColor" />
        </svg>
      </Match>
      <Match when={props.plan === "100"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Black 100 plan</title>
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
          <rect x="0.5" y="14.5" width="9" height="9" stroke="currentColor" />
          <rect x="14.5" y="0.5" width="9" height="9" stroke="currentColor" />
          <rect x="14.5" y="14.5" width="9" height="9" stroke="currentColor" />
        </svg>
      </Match>
      <Match when={props.plan === "200"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Black 200 plan</title>
          <rect x="0.5" y="0.5" width="3" height="3" stroke="currentColor" />
          <rect x="0.5" y="5.5" width="3" height="3" stroke="currentColor" />
          <rect x="0.5" y="10.5" width="3" height="3" stroke="currentColor" />
          <rect x="0.5" y="15.5" width="3" height="3" stroke="currentColor" />
          <rect x="0.5" y="20.5" width="3" height="3" stroke="currentColor" />
          <rect x="5.5" y="0.5" width="3" height="3" stroke="currentColor" />
          <rect x="5.5" y="5.5" width="3" height="3" stroke="currentColor" />
          <rect x="5.5" y="10.5" width="3" height="3" stroke="currentColor" />
          <rect x="5.5" y="15.5" width="3" height="3" stroke="currentColor" />
          <rect x="5.5" y="20.5" width="3" height="3" stroke="currentColor" />
          <rect x="10.5" y="0.5" width="3" height="3" stroke="currentColor" />
          <rect x="10.5" y="5.5" width="3" height="3" stroke="currentColor" />
          <rect x="10.5" y="10.5" width="3" height="3" stroke="currentColor" />
          <rect x="10.5" y="15.5" width="3" height="3" stroke="currentColor" />
          <rect x="10.5" y="20.5" width="3" height="3" stroke="currentColor" />
          <rect x="15.5" y="0.5" width="3" height="3" stroke="currentColor" />
          <rect x="15.5" y="5.5" width="3" height="3" stroke="currentColor" />
          <rect x="15.5" y="10.5" width="3" height="3" stroke="currentColor" />
          <rect x="15.5" y="15.5" width="3" height="3" stroke="currentColor" />
          <rect x="15.5" y="20.5" width="3" height="3" stroke="currentColor" />
          <rect x="20.5" y="0.5" width="3" height="3" stroke="currentColor" />
          <rect x="20.5" y="5.5" width="3" height="3" stroke="currentColor" />
          <rect x="20.5" y="10.5" width="3" height="3" stroke="currentColor" />
          <rect x="20.5" y="15.5" width="3" height="3" stroke="currentColor" />
          <rect x="20.5" y="20.5" width="3" height="3" stroke="currentColor" />
        </svg>
      </Match>
    </Switch>
  )
}
