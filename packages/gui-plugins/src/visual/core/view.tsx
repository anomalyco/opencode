import { createMemo, Suspense, Show } from "solid-js"
import { parseVisual, type VisualSpec } from "./spec"
import { RENDERERS } from "./registry"

/**
 * Renders one visual from its fenced block. A malformed spec returns nothing, which is the CodeBlock contract for
 * "declined"; the original code block stays visible.
 */
export function VisualView(props: { code: string; context?: "inline" }) {
  const parsed = createMemo(() => parseVisual(props.code))

  const spec = (): VisualSpec | undefined => {
    const result = parsed()

    return result.ok ? result.spec : undefined
  }

  return (
    <Show when={spec()} keyed>
      {(value) => {
        const Component = RENDERERS[value.kind]

        return (
          <Suspense fallback={<div class="vz vz-loading">Loading visual</div>}>
            <Component spec={value} />
          </Suspense>
        )
      }}
    </Show>
  )
}
