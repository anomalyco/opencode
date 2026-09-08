/// <reference types="vite/client" />
import { createComponent, ErrorBoundary, onCleanup, type JSX } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import { $$component, type Registry } from "solid-refresh/dist/solid-refresh.mjs"

export { $$context, $$decline, $$refresh, $$registry } from "solid-refresh/dist/solid-refresh.mjs"
export { component as $$component }

function component<P extends Record<string, unknown>>(
  registry: Registry,
  id: string,
  render: (props: P) => JSX.Element,
  options?: Parameters<typeof $$component>[3],
) {
  const proxy = $$component(registry, id, render, options)
  return (props: P) =>
    createComponent(ErrorBoundary, {
      fallback(error: unknown, reset: () => void) {
        // Retry only this failed subtree. Resetting the app's boundary destroys its providers and route.
        import.meta.hot?.on("vite:afterUpdate", reset)
        onCleanup(() => import.meta.hot?.off("vite:afterUpdate", reset))
        return jsx("text", { children: `${id}: ${String(error)}\nFix the component and save to retry.` })
      },
      get children() {
        return createComponent(proxy, props)
      },
    })
}
