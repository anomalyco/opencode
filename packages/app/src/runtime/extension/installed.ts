import { createMemo, createResource, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Bridge, Installed } from "@opencode/gui-extensions/sdk/bridge"

/** Saved enable preferences and manager metadata; activation and blocked-dependency status belong to the host. */
export function createInstalled(bridge: Bridge | undefined) {
  const [state, setState] = createStore<{ list?: readonly Installed[] }>({})
  // A pushed list is newer than the initial reply, so a reply that arrives after one is dropped.
  const pushed = { count: 0 }
  const [initial] = createResource(async () => (bridge ? bridge.manager.initial?.catch(() => undefined) : []))

  // Metadata still loads for settings and failure reporting. Activation can use known preload rows before it arrives.
  createResource(async () => {
    if (!bridge) return

    const seen = pushed.count
    const list = await bridge.manager.list()

    if (pushed.count === seen) setState("list", reconcile([...list]))
  })

  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type !== "extensions") return
        pushed.count++
        setState("list", reconcile([...message.list]))
      }),
    )

  return {
    enableState: createMemo(() => state.list ?? initial.latest),
    list: () => state.list ?? [],
  }
}
