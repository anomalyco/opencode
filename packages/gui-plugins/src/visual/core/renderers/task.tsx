import { For, Show } from "solid-js"
import { num, object, objects, optionalStr, str } from "../json"
import { short } from "../format"
import { Readout } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

type StepState = "done" | "active" | "pending" | "blocked"

interface Step {
  label: string
  detail?: string
  state: StepState
}

export function TaskVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}

  const steps = (): Step[] =>
    objects(data().steps)
      .slice(0, 12)
      .map((item) => ({
        label: str(item.label, "Step"),
        detail: optionalStr(item.detail),
        state: normalize(str(item.state, "pending")),
      }))

  const counts = () => ({
    done: steps().filter((step) => step.state === "done").length,
    active: steps().filter((step) => step.state === "active").length,
    blocked: steps().filter((step) => step.state === "blocked").length,
  })

  const overall = () => {
    const declared = str(data().status, "")

    if (declared === "done" || declared === "blocked" || declared === "running") return declared

    if (counts().blocked > 0) return "blocked"

    if (counts().active > 0) return "running"

    return steps().every((step) => step.state === "done") ? "done" : "running"
  }

  const rowHeight = () => (steps().some((step) => step.detail) ? 52 : 40)
  const height = () => Math.max(140, 32 + steps().length * rowHeight())

  return (
    <VisualFrame
      spec={props.spec}
      height={height()}
      stage={
        <div
          style={{
            display: "grid",
            "grid-template-columns": "22px minmax(0, 1fr) auto",
            "column-gap": "10px",
            padding: "6px 2px 8px",
            "font-size": "12.5px",
          }}
          role="list"
          aria-label={props.spec.title}
        >
          <For each={steps()}>
            {(step, index) => (
              <div
                role="listitem"
                style={{
                  display: "grid",
                  "grid-template-columns": "subgrid",
                  "grid-column": "1 / -1",
                  "align-items": "start",
                  "min-height": `${rowHeight()}px`,
                }}
              >
                <div style={{ position: "relative", height: "100%", "min-height": `${rowHeight()}px` }}>
                  <Show when={index() < steps().length - 1}>
                    <span
                      style={{
                        position: "absolute",
                        left: "5px",
                        top: "18px",
                        bottom: "-2px",
                        width: "1px",
                        background: step.state === "done" ? "var(--v-fg-3)" : "var(--v-line)",
                      }}
                    />
                  </Show>
                  <span
                    class={step.state === "active" ? "vz-pulse" : undefined}
                    style={{
                      position: "absolute",
                      left: "1px",
                      top: "8px",
                      width: step.state === "active" ? "9px" : "7px",
                      height: step.state === "active" ? "9px" : "7px",
                      "border-radius": "50%",
                      background: stepDot(step.state),
                      border: step.state === "pending" ? "1px solid var(--v-line-2)" : "none",
                    }}
                  />
                </div>
                <div style={{ "padding-top": "2px", "min-width": "0" }}>
                  <div
                    style={{
                      color: step.state === "pending" ? "var(--v-fg-3)" : "var(--v-fg)",
                      "overflow-wrap": "anywhere",
                      "line-height": "1.35",
                    }}
                  >
                    {short(step.label, 84)}
                  </div>
                  <Show when={step.detail}>
                    <div
                      style={{
                        color: "var(--v-fg-3)",
                        "font-size": "11px",
                        "line-height": "1.4",
                        "margin-top": "2px",
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {short(step.detail!, 110)}
                    </div>
                  </Show>
                </div>
                <div
                  style={{
                    "padding-top": "3px",
                    "font-family": "var(--v-mono)",
                    "font-size": "11px",
                    color: stepInk(step.state),
                  }}
                >
                  {step.state === "active" ? "running" : step.state}
                </div>
              </div>
            )}
          </For>
        </div>
      }
      readouts={
        <>
          <Readout label="Status" value={overall()} tone={statusTone(overall())} />
          <Readout label="Done" value={`${counts().done}/${steps().length}`} />
          <Show when={num(data().elapsed, 0) > 0}>
            <Readout label="Elapsed" value={`${num(data().elapsed, 0)} s`} />
          </Show>
        </>
      }
    />
  )
}

function statusTone(value: string): "accent" | "critical" | undefined {
  if (value === "running") return "accent"

  if (value === "blocked") return "critical"

  return undefined
}

function stepDot(state: StepState): string {
  if (state === "blocked") return "var(--v-critical)"

  if (state === "done") return "var(--v-fg-3)"

  if (state === "active") return "var(--v-accent-text)"

  return "transparent"
}

function stepInk(state: StepState): string {
  if (state === "blocked") return "var(--v-critical)"

  if (state === "active") return "var(--v-accent-text)"

  return "var(--v-fg-3)"
}

function normalize(value: string): StepState {
  if (value === "done" || value === "complete" || value === "completed") return "done"

  if (value === "active" || value === "running") return "active"

  if (value === "blocked" || value === "error" || value === "failed") return "blocked"

  return "pending"
}
