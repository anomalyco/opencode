import type { Event } from "@opencode-ai/sdk/v2"
import { useArgs } from "./args"
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  workspace: string | undefined
}

export function useEvent() {
  const args = useArgs()
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      // A session resumed via `-s` from a different directory belongs to a
      // different project than the launch cwd. Deliver its events too so the
      // TUI live-renders without chdir-ing the process. See #28581.
      if (
        event.directory === "global" ||
        event.project === project.project() ||
        (args.sessionProjectID !== undefined && event.project === args.sessionProjectID)
      ) {
        handler(event.payload, { workspace: event.workspace })
      }
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
