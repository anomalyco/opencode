import { createResource, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Bridge, Installed } from "@opencode/gui-extensions/sdk/bridge"

/** The extensions main reports to this window: the initial list, then every list it pushes. */
export function createInstalled(bridge: Bridge | undefined) {
  const [state, setState] = createStore({ list: [] as Installed[] })
  // A pushed list is newer than the initial reply, so a reply that arrives after one is dropped.
  const pushed = { count: 0 }
  const [loaded] = createResource(async () => {
    if (!bridge) return true
    const seen = pushed.count
    const list = await bridge.manager.list()
    if (pushed.count === seen) setState("list", reconcile([...list]))
    return true
  })
  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type !== "extensions") return
        pushed.count++
        setState("list", reconcile([...message.list]))
      }),
    )
  return { loaded, list: () => state.list }
}
