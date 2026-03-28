import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useParallel } from "@tui/context/parallel"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { ParallelPlan } from "./parallel-plan"
import { ParallelStatus } from "./parallel-status"
import { ParallelMerge } from "./parallel-merge"
import { TextAttributes } from "@opentui/core"
import type { Plan } from "@/parallel/schema"

export function Parallel() {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const route = useRoute()
  const parallel = useParallel()
  const local = useLocal()
  const sdk = useSDK()
  const bus = sdk.event as { on(type: string, handler: (evt: { properties: Record<string, unknown> }) => void): () => void }
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [switchedOnComplete, setSwitchedOnComplete] = createSignal(false)
  const isStatus = () => {
    const s = parallel.plan?.status
    return (
      s === "approved" ||
      s === "spawning" ||
      s === "running" ||
      s === "merging" ||
      s === "integrating" ||
      s === "recovering" ||
      s === "publishing"
    )
  }
  const back = () => {
    if (route.previous) {
      route.goBack()
      return
    }
    if (route.data.type === "parallel" && route.data.returnTo) {
      route.navigate(route.data.returnTo)
      return
    }
    route.navigate({ type: "home" })
  }

  const planID = () => (route.data.type === "parallel" ? route.data.planID : null)

  async function fetchPlan(id: string) {
    const res = await sdk.fetch(`${sdk.url}/parallel/${id}`)
    if (!res.ok) throw new Error("Plan not found")
    return res.json()
  }

  // Load plan on mount / route change
  createEffect(() => {
    const id = planID()
    if (!id) return
    setLoading(true)
    setError(null)
    setSwitchedOnComplete(false)
    fetchPlan(id)
      .then((plan) => parallel.setPlan(plan))
      .catch(() => setError("Plan not found"))
      .finally(() => setLoading(false))
  })

  createEffect(() => {
    const id = planID()
    if (!id) return
    const offPlan = bus.on("parallel.plan.updated", (evt) => {
      const value = evt.properties.plan
      if (!value || typeof value !== "object" || !("id" in value) || value.id !== id) return
      parallel.setPlan(value as Plan)
    })

    const offWorker = bus.on("parallel.worker.updated", (evt) => {
      if (evt.properties.planID !== id) return
      const value = evt.properties.worker
      if (!value || typeof value !== "object" || !("subtaskID" in value)) return
      parallel.setPlan((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          workers: prev.workers.map((worker) =>
            worker.subtaskID === value.subtaskID ? (value as typeof prev.workers[number]) : worker,
          ),
        }
      })
    })

    onCleanup(() => {
      offPlan()
      offWorker()
    })
  })

  // Auto-switch to build agent when plan completes successfully
  createEffect(() => {
    const plan = parallel.plan
    if (plan?.status === "done" && !switchedOnComplete()) {
      setSwitchedOnComplete(true)
      local.agent.set("build")
    }
  })

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "escape") {
      if (isStatus()) return
      back()
      evt.preventDefault()
    }
  })

  return (
    <Show
      when={!loading() && !error() && parallel.plan}
      keyed
      fallback={
        <box
          width={dim().width}
          height={dim().height}
          backgroundColor={theme.background}
          alignItems="center"
          justifyContent="center"
        >
          <box
            flexDirection="column"
            width={Math.min(60, dim().width - 2)}
            backgroundColor={theme.backgroundPanel}
            padding={2}
            alignItems="center"
          >
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {loading() ? "Loading plan..." : (error() ?? "No parallel plans found")}
            </text>
            <text fg={theme.textMuted}>Press ESC to go back</text>
          </box>
        </box>
      }
    >
      {(plan) => (
        <box
          width={dim().width}
          height={dim().height}
          backgroundColor={theme.background}
          alignItems="center"
          paddingTop={2}
        >
          <Show when={plan.status === "proposed" || plan.status === "draft"}>
            <ParallelPlan plan={plan} onApproved={() => {}} onCancelled={back} />
          </Show>
          <Show when={plan.status === "paused" || plan.status === "approved" || plan.status === "spawning" || plan.status === "running"}>
            <ParallelStatus plan={plan} onCancelled={back} onBack={back} />
          </Show>
          <Show
            when={
              plan.status === "merging" ||
              plan.status === "integrating" ||
              plan.status === "recovering" ||
              plan.status === "publishing"
            }
          >
            <ParallelMerge plan={plan} />
          </Show>
          <Show when={plan.status === "integrated"}>
            <box
              flexDirection="column"
              width={Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.info}>
                Integrated
              </text>
              <text fg={theme.text}>Workers merged into integration branch</text>
              <text fg={theme.textMuted}>Publish step can be triggered from CLI or resume flow</text>
              <text fg={theme.textMuted}>Press ESC to go back</text>
            </box>
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
              <text fg={theme.textMuted}>Press ESC to go back</text>
            </box>
          </Show>
          <Show when={plan.status === "partial_success"}>
            <box
              flexDirection="column"
              width={Math.min(60, dim().width - 2)}
              backgroundColor={theme.backgroundPanel}
              padding={2}
              alignItems="center"
            >
              <text attributes={TextAttributes.BOLD} fg={theme.warning}>
                Partial Success
              </text>
              <text fg={theme.text}>Some subtasks completed successfully</text>
              <text fg={theme.textMuted}>Press ESC to go back</text>
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
              <text fg={theme.text}>
                {plan.workers.length > 0 && plan.workers.every((w) => w.status === "pending")
                  ? "No workers started. Check /parallel config and selected models."
                  : "Plan execution failed"}
              </text>
              <Show when={plan.error}>
                <text fg={theme.textMuted}>
                  {plan.error!.code} @ {plan.error!.stage}
                </text>
                <text fg={theme.error} wrapMode="word">
                  {plan.error!.message}
                </text>
              </Show>
              <text fg={theme.textMuted}>Press ESC to go back</text>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}
