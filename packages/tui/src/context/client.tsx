import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client"
import { createClientConnection, createPersistentPtyClient } from "@opencode/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createResource, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"

type ManagedService = {
  reconnect: (signal: AbortSignal) => Promise<{ api: OpenCodeClient; url?: string }>
  restart: () => Promise<void>
}

type ClientEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export const { use: useClient, provider: ClientProvider } = createSimpleContext({
  name: "Client",
  init: (props: { api: OpenCodeClient; url?: string; service?: ManagedService }) => {
    const log = useLog({ component: "client" })
    const service = props.service
    const events = createGlobalEmitter<ClientEventMap>()
    let api = props.api
    let url = props.url
    let persistentPty = url ? createPersistentPtyClient(api, { url }) : undefined

    const connection = createClientConnection(api, {
      reconnect: service
        ? async (signal) => {
            const next = await service.reconnect(signal)
            api = next.api
            if (next.url) url = next.url
            if (url) persistentPty = createPersistentPtyClient(api, { url })
            return api
          }
        : undefined,
      onEvent(event) {
        events.emit(event.type, event)
      },
      log,
    })

    let home: { api: OpenCodeClient; value: Promise<string | undefined> } | undefined
    function resolveServerHome() {
      if (home?.api === api) return home.value
      const value = api.server.info().then((info) => info.paths.home)
      home = { api, value }
      value.catch(() => {
        if (home?.value === value) home = undefined
      })
      return value
    }
    const [serverHome] = createResource(
      () => connection.status() === "connected" && api,
      () => resolveServerHome().catch(() => undefined),
    )

    onCleanup(() => {
      events.clear()
    })

    return {
      get api() {
        return api
      },
      get persistentPty() {
        if (!persistentPty) throw new Error("Persistent terminal server endpoint is unavailable")
        return persistentPty
      },
      event: {
        on: events.on,
        listen: events.listen,
      },
      connection,
      serverHome,
      resolveServerHome,
      restart: service?.restart,
    }
  },
})
