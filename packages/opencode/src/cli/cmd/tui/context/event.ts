import type { Event } from "@opencode-ai/sdk/v2"
import type { PluginEvent, PluginEventHandler } from "@opencode-ai/plugin/tui"
import { useProject } from "./project"
import { useSDK } from "./sdk"

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event) => void) {
    return sdk.event.on("event", (event) => {
      // Special hack for truly global events
      if (event.directory === "global") {
        handler(event.payload)
      }

      if (project.workspace.current()) {
        if (event.workspace === project.workspace.current()) {
          handler(event.payload)
        }

        return
      }

      if (event.directory === project.instance.directory()) {
        handler(event.payload)
      }
    })
  }

  function on<T extends Event["type"] | string>(type: T, handler: PluginEventHandler<T>) {
    const fn = handler as (event: PluginEvent) => void
    return subscribe((event) => {
      if (event.type !== type) return
      fn(event as PluginEvent)
    })
  }

  return {
    subscribe,
    on,
  }
}
