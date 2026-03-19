import { Show, createEffect, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useParallel } from "@tui/context/parallel"
import { useSDK } from "@tui/context/sdk"
import { ParallelPlan } from "./parallel-plan"
import { ParallelStatus } from "./parallel-status"
import { ParallelMerge } from "./parallel-merge"
import { TextAttributes } from "@opentui/core"
import { useToast } from "@tui/ui/toast"
import type { Plan } from "@/parallel/schema"
import { ParallelEvent } from "@/parallel/events"

export function Parallel() {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const route = useRoute()
  const parallel = useParallel()
  const sdk = useSDK()
  const toast = useToast()

  const planID = () => (route.data.type === "parallel" ? route.data.planID : null)

  createEffect(() => {
    if (!planID()) return
    sdk.client.parallel
      .get({ planID: planID()! })
      .then((result) => {
        if (result.data) {
          parallel.setPlan(result.data)
        }
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load plan")
      })
  })

  onMount(() => {
    const unsub = sdk.event.on(ParallelEvent.PlanUpdated.type, (evt) => {
      if (evt.properties.plan.id === planID()) {
        parallel.setPlan(evt.properties.plan)
      }
    })
    return unsub
  })

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
              width={() => Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.success}>
                ✓ Complete
              </text>
              <text fg={theme.text}>All subtasks merged successfully</text>
            </box>
          </Show>
          <Show when={plan.status === "failed"}>
            <box
              flexDirection="column"
              width={() => Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.error}>
                ✗ Failed
              </text>
              <text fg={theme.text}>Plan execution failed</text>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}
