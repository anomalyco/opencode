import type { OpenCodeEvent } from "@opencode-ai/client"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string | undefined
  workspace: string | undefined
}

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: OpenCodeEvent, metadata: EventMetadata) => void) {
    return sdk.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory, workspace: details.location?.workspaceID })
    })
  }

  function on<T extends OpenCodeEvent["type"]>(
    type: T,
    handler: (event: Extract<OpenCodeEvent, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return sdk.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory, workspace: event.location?.workspaceID })
    })
  }

  return {
    subscribe,
    on,
  }
}
