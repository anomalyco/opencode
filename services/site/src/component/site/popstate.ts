import { isServer } from "solid-js/web"

// The router swaps the page as soon as popstate fires. Listeners on window run in the order they
// were added, so this one, added when the app loads (before the router adds its own), sees the
// event first. A page can hold a back or forward step here and hand the router a copy later.
let hold: ((event: PopStateEvent) => boolean) | undefined

/** While set, `handler` sees each popstate first; returning true keeps it from the router. */
export function holdPopstate(handler: (event: PopStateEvent) => boolean) {
  hold = handler
  return () => {
    if (hold === handler) hold = undefined
  }
}

if (!isServer) {
  window.addEventListener("popstate", (event) => {
    if (hold?.(event)) event.stopImmediatePropagation()
  })
}
