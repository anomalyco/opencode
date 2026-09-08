/// <reference types="vite/client" />
import { createComponent, createSignal, ErrorBoundary, onCleanup, Show, type JSX } from "solid-js"
import { $$component, type Registry } from "solid-refresh/dist/solid-refresh.mjs"
import type { ErrorOverlay } from "./error-overlay"

let overlay: typeof ErrorOverlay
const [activeError, setActiveError] = createSignal<symbol>()
export function configureErrorOverlay(component: typeof ErrorOverlay) {
  overlay = component
}

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
        const token = Symbol(id)
        // Several instances can fail in one update. Stack neither dialogs nor translucent backdrops.
        setActiveError(token)
        onCleanup(() => {
          if (activeError() === token) setActiveError(undefined)
        })
        // Retry only this failed subtree. Resetting the app's boundary destroys its providers and route.
        import.meta.hot?.on("vite:afterUpdate", reset)
        onCleanup(() => import.meta.hot?.off("vite:afterUpdate", reset))
        return createComponent(Show, {
          keyed: true,
          get when() {
            return activeError() === token
          },
          get children() {
            return createComponent(overlay, { component: id, error, onClose: () => setActiveError(undefined) })
          },
        })
      },
      get children() {
        return createComponent(proxy, props)
      },
    })
}
