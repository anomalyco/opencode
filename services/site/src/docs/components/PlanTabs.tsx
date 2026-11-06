import { For, type JSX } from "solid-js"
import { SlotScope } from "./Slot"

const plans = [
  { id: "go", label: "Go" },
  { id: "go-plus", label: "Go Plus" },
  { id: "go-teams", label: "Go Teams" },
] as const

// One panel per plan, from the `slot="go"`, `slot="go-plus"` and `slot="go-teams"` children. The tabs
// switch, and stay in step across every PlanTabs with the same syncKey, through client.ts.
export function PlanTabs(props: { id: string; label: string; syncKey: string; children?: JSX.Element }) {
  return (
    <div class="docs-plan-tabs" data-plan-tabs data-sync-key={props.syncKey}>
      <div class="docs-plan-tabs-list" role="tablist" aria-label={props.label}>
        <For each={plans}>
          {(plan, index) => (
            <button
              type="button"
              role="tab"
              id={`${props.id}-tab-${plan.id}`}
              aria-controls={`${props.id}-panel-${plan.id}`}
              aria-selected={index() === 0 ? "true" : "false"}
              tabindex={index() === 0 ? 0 : -1}
              data-plan-tab={plan.id}
              data-funnel={`plan-tab:${plan.id}`}
            >
              {plan.label}
            </button>
          )}
        </For>
      </div>
      <For each={plans}>
        {(plan, index) => (
          <div
            role="tabpanel"
            id={`${props.id}-panel-${plan.id}`}
            aria-labelledby={`${props.id}-tab-${plan.id}`}
            hidden={index() !== 0}
            data-plan-panel={plan.id}
          >
            <SlotScope name={plan.id}>{props.children}</SlotScope>
          </div>
        )}
      </For>
    </div>
  )
}
