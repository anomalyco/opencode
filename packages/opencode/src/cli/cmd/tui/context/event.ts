import type { Event } from "@opencode-ai/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"
import { useArgs } from "./args"

type EventMetadata = {
  workspace: string | undefined
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()
  const args = useArgs()

  function eventSessionID(event: Event) {
    const properties = event.properties as {
      sessionID?: string
      info?: { id?: string; sessionID?: string }
      part?: { sessionID?: string }
    }
    return properties.sessionID ?? properties.info?.sessionID ?? properties.info?.id ?? properties.part?.sessionID
  }

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      const sessionID = args.sessionID
      if (
        event.directory === "global" ||
        event.project === project.project() ||
        (sessionID && eventSessionID(event.payload) === sessionID)
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
