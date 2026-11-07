import { createMemo, Show, Suspense, type JSX } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { parseVisual } from "./spec"
import { RENDERERS } from "./registry"

/**
 * Renders one visual from its fenced block. A malformed spec shows the block's source through `fallback`, and a valid
 * spec renders lazily. The block is parsed once here, so the renderer does not repeat the parser.
 */
export function VisualView(props: { code: string; fallback?: JSX.Element }) {
  const ctx = usePlugin()

  const spec = createMemo(() => {
    const result = parseVisual(props.code)

    return result.ok ? result.spec : undefined
  })

  return (
    <Show when={spec()} keyed fallback={props.fallback ?? null}>
      {(value) => {
        const Component = RENDERERS[value.kind]

        return (
          <Suspense fallback={<div class="vz vz-loading">{ctx.t("view.loading")}</div>}>
            <Component spec={value} />
          </Suspense>
        )
      }}
    </Show>
  )
}
