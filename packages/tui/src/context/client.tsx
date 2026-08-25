import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client"
import { createClientConnection } from "@opencode-ai/client/solid"
import type { Endpoint } from "@opencode-ai/client/service"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"

type ManagedService = {
  reconnect: (signal: AbortSignal) => Promise<{ api: OpenCodeClient; endpoint?: Endpoint }>
  restart: () => Promise<void>
}

type ClientEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export const { use: useClient, provider: ClientProvider } = createSimpleContext({
  name: "Client",
  init: (props: { api: OpenCodeClient; endpoint?: Endpoint; service?: ManagedService }) => {
    const log = useLog({ component: "client" })
    const service = props.service
    const events = createGlobalEmitter<ClientEventMap>()
    let api = props.api
    let endpoint = props.endpoint

    const connection = createClientConnection(api, {
      reconnect: service
        ? async (signal) => {
            const next = await service.reconnect(signal)
            api = next.api
            if (next.endpoint) endpoint = next.endpoint
            return api
          }
        : undefined,
      onEvent(event) {
        events.emit(event.type, event)
      },
      log,
    })

    onCleanup(() => {
      events.clear()
    })

    return {
      get api() {
        return api
      },
      get endpoint() {
        return endpoint
      },
      event: {
        on: events.on,
        listen: events.listen,
      },
      connection,
      restart: service?.restart,
    }
  },
})
