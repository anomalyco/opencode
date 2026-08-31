import type { OpenCodeEvent } from "@opencode-ai/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
  workspace: string | undefined
}
type OpenCodeEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: OpenCodeEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory, workspace: details.location?.workspaceID })
    })
  }

  function on<T extends OpenCodeEvent["type"]>(
    type: T,
    handler: (event: OpenCodeEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory, workspace: event.location?.workspaceID })
    })
  }

  return {
    subscribe,
    on,
  }
}
