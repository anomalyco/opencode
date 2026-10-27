import { For, splitProps, type ComponentProps } from "solid-js"
import { syncSpinPhase } from "../hooks/spin-phase"
import { radarDots, radarKeyframes, radarLoop } from "./spinner-radar"

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows Soft Radar. Non-AI
// loading uses Loader.

const keyframes = "spinner-radar"

const dots = radarDots()

// The keyframes are added to the document once, the first time a spinner renders.
let added = false

export function Spinner(props: ComponentProps<"svg"> & { "data-component"?: string }) {
  const [local, rest] = splitProps(props, ["class", "classList", "data-component"])

  if (!added) {
    added = true
    const style = document.createElement("style")
    style.textContent = radarKeyframes(keyframes)
    document.head.append(style)
  }

  return (
    <svg
      {...rest}
      ref={syncSpinPhase}
      viewBox="0 0 16 16"
      data-component={local["data-component"] ?? "spinner"}
      data-slot="spinner-dots"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
      fill="currentColor"
    >
      <For each={dots}>
        {(dot) => (
          <rect
            x={dot.x}
            y={dot.y}
            width={dot.size}
            height={dot.size}
            rx={dot.size * 0.24}
            style={{
              "--still": dot.still,
              animation: dot.steady
                ? undefined
                : `${keyframes}-${dot.shape} calc(${radarLoop}s * var(--spinner-time, 1)) linear calc(${-radarLoop * (1 - dot.at)}s * var(--spinner-time, 1)) infinite`,
            }}
          />
        )}
      </For>
    </svg>
  )
}
