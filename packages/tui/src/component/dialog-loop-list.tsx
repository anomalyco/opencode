import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { useRoute } from "../context/route"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { Locale } from "../util/locale"
import type { Loop } from "@opencode-ai/sdk/v2"

function statusLabel(status: Loop["status"]) {
  switch (status) {
    case "running":
      return "running"
    case "paused":
      return "paused"
    case "completed":
      return "completed"
    case "stalled":
      return "stalled — no progress"
    case "cancelled":
      return "cancelled"
    case "max_reached":
      return "max iterations reached"
    case "error":
      return "error"
  }
}

export function DialogLoopList() {
  const dialog = useDialog()
  const sdk = useSDK()
  const event = useEvent()
  const toast = useToast()
  const [loops, setLoops] = createSignal<Loop[]>([])

  const [, { refetch }] = createResource(async () => {
    const result = await sdk.client.loop.list()
    setLoops(result.data ?? [])
    return result.data
  })

  event.on("loop.updated", (evt) => {
    const updated = evt.properties.loop
    setLoops((current) => {
      const next = current.filter((loop) => loop.id !== updated.id)
      next.push(updated)
      return next.toSorted((a, b) => b.startedAt - a.startedAt)
    })
  })

  const options = createMemo(() =>
    loops()
      .toSorted((a, b) => b.startedAt - a.startedAt)
      .map((loop) => ({
        title: Locale.truncate(loop.prompt, 60),
        value: loop.id,
        footer:
          `${statusLabel(loop.status)} · iter ${loop.iteration}/${loop.maxIterations}` +
          (loop.currentChange ? ` · ${loop.currentChange} [${loop.currentGate ?? "?"}]` : ""),
      })),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Work — running and finished"
      options={options()}
      skipFilter={true}
      emptyView={
        <text>
          Nothing has run yet. /loop &lt;prompt&gt; keeps working on that prompt until it is done, then continues
          into planned openspec work if any exists (--no-eternal to stop instead). /backlog works
          the planned tasks itself — change by change, implement, test, verify, commit — and stops when none
          are left. Neither ever pushes from the model directly. Set experimental.queue_gate so the test and
          verify commands run in the right directory for this repo.
        </text>
      }
      onSelect={(option) => {
        const loop = loops().find((x) => x.id === option.value)
        if (!loop) return
        dialog.replace(() => <DialogLoopIterations loop={loop} />)
      }}
      actions={[
        {
          command: "loop.pause",
          title: "pause",
          disabled: (option) => loops().find((x) => x.id === option?.value)?.status !== "running",
          onTrigger: async (option) => {
            const result = await sdk.client.loop.pause({ loopID: option.value })
            if (result.error)
              toast.show({ variant: "error", title: "Failed to pause loop", message: errorMessage(result.error) })
            await refetch()
          },
        },
        {
          command: "loop.resume",
          title: "resume",
          disabled: (option) => loops().find((x) => x.id === option?.value)?.status !== "paused",
          onTrigger: async (option) => {
            const result = await sdk.client.loop.resume({ loopID: option.value })
            if (result.error)
              toast.show({ variant: "error", title: "Failed to resume loop", message: errorMessage(result.error) })
            await refetch()
          },
        },
        {
          command: "loop.cancel",
          title: "cancel",
          disabled: (option) => {
            const status = loops().find((x) => x.id === option?.value)?.status
            return status !== "running" && status !== "paused"
          },
          onTrigger: async (option) => {
            const result = await sdk.client.loop.cancel({ loopID: option.value })
            if (result.error)
              toast.show({ variant: "error", title: "Failed to cancel loop", message: errorMessage(result.error) })
            await refetch()
          },
        },
      ]}
    />
  )
}

function DialogLoopIterations(props: { loop: Loop }) {
  const dialog = useDialog()
  const route = useRoute()

  const options = createMemo(() =>
    props.loop.iterations
      .toSorted((a, b) => b.iteration - a.iteration)
      .map((iteration) => ({
        title: `iteration ${iteration.iteration}${iteration.complete ? " (complete)" : ""}`,
        value: iteration.sessionID,
        footer: `${iteration.toolCalls} tool call(s) · ${iteration.outputLength} chars output`,
      })),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={`Loop: ${Locale.truncate(props.loop.prompt, 50)}`}
      options={options()}
      skipFilter={true}
      emptyView={<text>No iterations yet</text>}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
    />
  )
}
