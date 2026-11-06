import { createMemo, ErrorBoundary, Show, Suspense } from "solid-js"
import { VisualError } from "./frame"
import { parseVisual, type VisualSpec } from "./spec"
import { RENDERERS } from "./registry"

/**
 * Renders one visual from its fenced block. Inline blocks keep the code for a malformed spec, because returning
 * nothing is the CodeBlock contract for "declined"; the workbench shows the parse error instead.
 */
export function VisualView(props: { code: string; context?: "inline" | "workbench"; onError?: (message: string) => void }) {
  const parsed = createMemo(() => parseVisual(props.code))

  const spec = (): VisualSpec | undefined => {
    const result = parsed()

    return result.ok ? result.spec : undefined
  }

  const failure = (): string => {
    const result = parsed()

    return result.ok ? "" : result.error
  }

  return (
    <Show
      when={spec()}
      keyed
      fallback={
        <Show when={props.context === "workbench"}>
          <VisualError message={failure()} />
        </Show>
      }
    >
      {(value) => {
        const content = () => {
          const Component = RENDERERS[value.kind]

          return (
            <Suspense fallback={<div class="vz vz-loading">Loading visual</div>}>
              <Component spec={value} />
            </Suspense>
          )
        }

        if (props.context !== "workbench") return content()

        return (
          <ErrorBoundary
            fallback={(error: Error) => {
              props.onError?.(error.message)

              return <VisualError title="The renderer stopped" message={error.message} />
            }}
          >
            {content()}
          </ErrorBoundary>
        )
      }}
    </Show>
  )
}

/** A stable, short id for a block, used to deduplicate the workbench list. */
export function visualID(code: string): string {
  let hash = 2166136261

  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}
