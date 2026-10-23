import { createSignal, For, Show, splitProps, type ComponentProps } from "solid-js"
import { syncSpinPhase } from "../hooks/spin-phase"
import { motionTuning } from "../motion-tuning"
import { spinnerDots, spinnerKeyframes, spinnerVariants, type SpinnerVariant } from "./spinner-variants"

export type SpinnerVariantName = "today" | keyof typeof spinnerVariants

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows Soft Radar; Knobs →
// Experiments tries the other dot-matrix variations, and Today's PNG, in its place. Non-AI loading uses Loader.
const choice = motionTuning.choice("spinner.variant", {
  label: "Style",
  group: "Experiments",
  card: "Activity spinner",
  order: 30,
  description: "The spinner on running sessions, loaders and the activity chip.",
  target: '[data-slot="spinner-grid"], [data-slot="spinner-dots"]',
  value: "radar",
  // SAFETY: built from spinnerVariants' own keys, plus "today".
  labels: Object.fromEntries([
    ["today", "Today"],
    ...Object.entries(spinnerVariants).map(([name, variant]) => [name, variant.label]),
  ]) as Record<SpinnerVariantName, string>,
})

const [chosen, setChosen] = createSignal(choice())

motionTuning.subscribe(() => setChosen(choice()))

// Each variation's keyframes are added to the document once, the first time one renders.
const added = new Set<string>()

export function Spinner(props: ComponentProps<"svg"> & { "data-component"?: string; variant?: SpinnerVariantName }) {
  const [local, rest] = splitProps(props, ["variant", "class", "classList", "data-component"])
  const name = () => local.variant ?? chosen()
  // SAFETY: "today" is the only name that isn't a key of spinnerVariants, and it maps to undefined.
  const variant = (): SpinnerVariant | undefined => spinnerVariants[name() as keyof typeof spinnerVariants]
  const classList = () => ({ ...local.classList, [local.class ?? ""]: !!local.class })

  return (
    // Keyed, so switching variations builds a fresh SVG: its dots, keyframes and phase pin all come from the new one.
    <Show
      when={variant()}
      keyed
      fallback={
        <svg
          {...rest}
          viewBox="0 0 16 16"
          data-component={local["data-component"] ?? "spinner"}
          data-slot="spinner-grid"
          classList={classList()}
          fill="currentColor"
        >
          <rect data-reduced-motion x={7} y={7} width={2} height={2} />
        </svg>
      }
    >
      {(current) => {
        const keyframes = `spinner-${name()}`

        if (!added.has(keyframes)) {
          added.add(keyframes)
          const style = document.createElement("style")
          style.textContent = spinnerKeyframes(keyframes, current)
          document.head.append(style)
        }

        return (
          <svg
            {...rest}
            ref={syncSpinPhase}
            viewBox="0 0 16 16"
            data-component={local["data-component"] ?? "spinner"}
            data-slot="spinner-dots"
            data-variant={name()}
            classList={classList()}
            fill="currentColor"
          >
            <For each={spinnerDots(current)}>
              {(dot) => {
                const loop = current.loop * dot.scale

                return (
                  <rect
                    x={dot.x}
                    y={dot.y}
                    width={dot.size}
                    height={dot.size}
                    rx={dot.size * 0.24}
                    style={{
                      "--still": dot.still,
                      animation: dot.hold
                        ? undefined
                        : `${keyframes}-${dot.shape} calc(${loop}s * var(--spinner-time, 1)) linear calc(${-loop * (1 - dot.at)}s * var(--spinner-time, 1)) infinite`,
                    }}
                  />
                )
              }}
            </For>
          </svg>
        )
      }}
    </Show>
  )
}
