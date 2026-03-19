import { Show, createEffect, onCleanup } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useParallel } from "@tui/context/parallel"
import { ParallelPlan } from "./parallel-plan"
import { ParallelStatus } from "./parallel-status"
import { ParallelMerge } from "./parallel-merge"
import { TextAttributes } from "@opentui/core"
import { Bus } from "@/bus"
import { ParallelEvent } from "@/parallel/events"
import { PlanStore } from "@/parallel/plan"
import { PlanID } from "@/parallel/schema"

export function Parallel() {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const route = useRoute()
  const parallel = useParallel()

  const planID = () => (route.data.type === "parallel" ? route.data.planID : null)

  // Load plan on mount / route change
  createEffect(() => {
    const id = planID()
    if (!id) return
    PlanStore.get(PlanID.make(id))
      .then((plan) => parallel.setPlan(plan))
      .catch(() => {})
  })

  // Subscribe to plan updates
  const unsub = Bus.subscribe(ParallelEvent.PlanUpdated, (evt) => {
    if (evt.properties.plan.id === planID()) {
      parallel.setPlan(evt.properties.plan)
    }
  })
  onCleanup(unsub)

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      route.navigate({ type: "home" })
      evt.preventDefault()
    }
  })

  return (
    <Show when={parallel.plan} keyed>
      {(plan) => (
        <box
          width={dim().width}
          height={dim().height}
          backgroundColor={theme.background}
          alignItems="center"
          paddingTop={2}
        >
          <Show when={plan.status === "proposed"}>
            <ParallelPlan plan={plan} onApproved={() => {}} onCancelled={() => route.navigate({ type: "home" })} />
          </Show>
          <Show when={plan.status === "spawning" || plan.status === "running"}>
            <ParallelStatus plan={plan} />
          </Show>
          <Show when={plan.status === "merging"}>
            <ParallelMerge plan={plan} />
          </Show>
          <Show when={plan.status === "done"}>
            <box
              flexDirection="column"
              width={Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.success}>
                Complete
              </text>
              <text fg={theme.text}>All subtasks merged successfully</text>
            </box>
          </Show>
          <Show when={plan.status === "failed"}>
            <box
              flexDirection="column"
              width={Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.error}>
                Failed
              </text>
              <text fg={theme.text}>Plan execution failed</text>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}
