import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { ErrorDetails } from "./error-details"

type Phase = "failed" | "retrying" | "connected"

type Args = { message: string; lines: number; phase: Phase }

function Preview(props: Args) {
  const [phase, setPhase] = createSignal(props.phase)

  createEffect(on([() => props.message, () => props.lines, () => props.phase], () => setPhase(props.phase)))
  createEffect(() => {
    if (phase() !== "retrying") return
    const timer = setTimeout(() => setPhase("connected"), 1500)

    onCleanup(() => clearTimeout(timer))
  })

  const details = () =>
    [
      props.message,
      ...Array.from(
        { length: props.lines },
        (_, i) => `Attempt ${i + 1}: workspace index did not acknowledge the handshake.`,
      ),
    ].join("\n")

  return (
    <div class="flex h-64 w-96 max-w-full flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 pt-4 text-sm">
      <div class="px-4 font-medium">Workspace index</div>
      <Show
        when={phase() !== "connected"}
        fallback={
          <div class="grid justify-items-start gap-3 px-4">
            <p role="status">Connected to the workspace index.</p>
            <Button onClick={() => setPhase("failed")}>Replay error</Button>
          </div>
        }
      >
        <ErrorDetails error={details()}>
          <Button
            disabled={phase() === "retrying"}
            aria-busy={phase() === "retrying"}
            onClick={() => setPhase("retrying")}
          >
            {phase() === "retrying" ? "Retrying…" : "Retry connection"}
          </Button>
        </ErrorDetails>
      </Show>
    </div>
  )
}

export default {
  title: "UI/ErrorDetails",
  id: "ui-error-details",
  component: Preview,
  args: { message: "Connection refused while opening the workspace index.", lines: 0, phase: "failed" } satisfies Args,
  argTypes: {
    lines: { control: { type: "range", min: 0, max: 40, step: 1 } },
    phase: { control: "select", options: ["failed", "retrying", "connected"] },
  },
}

export const ConnectionError = {}

export const LongDiagnostics = { args: { lines: 24 } }

export const Retrying = { args: { phase: "retrying" } }

export const Recovered = { args: { phase: "connected" } }
