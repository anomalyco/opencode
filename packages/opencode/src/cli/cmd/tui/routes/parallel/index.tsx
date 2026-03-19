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

export function Parallel() {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const route = useRoute()
  const parallel = useParallel()
  const local = useLocal()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [switchedOnComplete, setSwitchedOnComplete] = createSignal(false)

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

  // Poll for plan updates every 3s (SSE not available in Bun/TUI)
  createEffect(() => {
    const id = planID()
    if (!id) return

    // Try SSE first, fall back to polling
    let es: any = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const handleUpdate = (data: any) => {
      if (data.type === "parallel.plan.updated") {
        parallel.setPlan(data.payload.plan)
      }
    }

    // Check if EventSource is available (browser) or use polling (Bun/TUI)
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource(`${sdk.url}/parallel/${id}/events`)
        es.addEventListener("message", (e: MessageEvent) => {
          try {
            handleUpdate(JSON.parse(e.data))
          } catch {}
        })
        es.addEventListener("error", () => {
          // Will reconnect automatically
        })
      } catch {
        // Fall through to polling
        es = null
      }
    }

    // Fallback polling if SSE failed or unavailable
    if (!es) {
      pollTimer = setInterval(async () => {
        try {
          const res = await sdk.fetch(`${sdk.url}/parallel/${id}`)
          if (res.ok) {
            const plan = await res.json()
            parallel.setPlan(plan)
          }
        } catch {}
      }, 3000)
    }

    onCleanup(() => {
      if (es) es.close()
      if (pollTimer) clearInterval(pollTimer)
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
    if (evt.name === "escape") {
      route.navigate({ type: "home" })
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
            <ParallelPlan plan={plan} onApproved={() => {}} onCancelled={() => route.navigate({ type: "home" })} />
          </Show>
          <Show when={plan.status === "approved" || plan.status === "spawning" || plan.status === "running"}>
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
              <text fg={theme.text}>Plan execution failed</text>
              <text fg={theme.textMuted}>Press ESC to go back</text>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}
