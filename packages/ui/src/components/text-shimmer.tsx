import { For, createMemo, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  stepMs?: number
  durationMs?: number
}) => {
  const chars = createMemo(() => Array.from(props.text))
  const active = () => props.active ?? true

  return (
    <Dynamic
      component={props.as || "span"}
      data-component="text-shimmer"
      data-active={active()}
      class={props.class}
      aria-label={props.text}
      style={{
        "--text-shimmer-step": `${props.stepMs ?? 45}ms`,
        "--text-shimmer-duration": `${props.durationMs ?? 1200}ms`,
      }}
    >
      <For each={chars()}>
        {(char, index) => (
          <span data-slot="text-shimmer-char" aria-hidden="true" style={{ "--text-shimmer-index": `${index()}` }}>
            {char}
          </span>
        )}
      </For>
    </Dynamic>
  )
}
