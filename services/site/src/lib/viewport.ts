import { createSignal, onCleanup } from "solid-js"
import { getRequestEvent, isServer } from "solid-js/web"

// The one viewport tag (app.tsx). The new site's pages (Site) run under the notch and home indicator
// and pad their edge elements by the safe-area insets; the Console's pages keep the plain viewport.
// The server reads the flag when it renders the <head> tags, after the page has rendered. The
// browser keeps the mounted callers in a plain set, not a counter signal: a client navigation runs
// inside a transition, which forks signal values and lost a count.
const callers = new Set<object>()
const [changed, setChanged] = createSignal(undefined, { equals: false })

export const viewportContent = () =>
  (isServer ? getRequestEvent()?.locals.viewportCover : (changed(), callers.size > 0))
    ? "width=device-width, initial-scale=1, viewport-fit=cover"
    : "width=device-width, initial-scale=1"

/** Asks for viewport-fit=cover while the calling component is mounted. */
export function useViewportCover() {
  if (isServer) {
    const event = getRequestEvent()
    if (event) event.locals.viewportCover = true
    return
  }
  const caller = {}
  callers.add(caller)
  setChanged()
  onCleanup(() => {
    callers.delete(caller)
    setChanged()
  })
}
