import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { createClientConnection, type ClientConnectionStatus } from "@opencode-ai/client/solid"
import type { Event } from "@/types"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, onCleanup } from "solid-js"
import { createApiForServer, type ServerApi } from "@/utils/server"
import { usePlatform } from "./platform"
import { ServerConnection } from "./servers"
import { createRefCountMap } from "@/utils/refcount"
import { ServerScope } from "@/utils/server-scope"
import { useServer } from "./server"

export type ServerEvent = Event & { id?: string; current?: OpenCodeEvent }

export function adaptServerEvent(event: OpenCodeEvent): ServerEvent {
  return { id: event.id, type: event.type, properties: event.data, current: event } as ServerEvent
}

type ServerEventEmitter = ReturnType<typeof createGlobalEmitter<{ [key: string]: ServerEvent }>>
type CurrentEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }
type CurrentEventEmitter = ReturnType<typeof createGlobalEmitter<CurrentEventMap>>
export type ServerConnectionStatus = ClientConnectionStatus
type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  url: string
  api: ServerApi
  connection: {
    status: Accessor<ServerConnectionStatus>
    attempt: Accessor<number>
    error: Accessor<string | undefined>
  }
  eventByDir: {
    on: ServerEventEmitter["on"]
    listen: ServerEventEmitter["listen"]
  }
  event: {
    on: CurrentEventEmitter["on"]
    listen: CurrentEventEmitter["listen"]
  }
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const api = createApiForServer({ server: server.http, fetch: platform.fetch })
  const dirEmitter = createGlobalEmitter<{ [key: string]: ServerEvent }>()
  const emitter = createGlobalEmitter<CurrentEventMap>()

  const connection = createClientConnection(api, {
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(event) {
      emitter.emit(event.type, event)
      dirEmitter.emit(event.location?.directory ?? "global", adaptServerEvent(event))
    },
    log: {
      info(message, data) {
        if (message !== "event stream disconnected") return
        console.info("[global-sdk] event stream disconnected", { url: server.http.url, ...data })
      },
    },
  })

  onCleanup(() => {
    dirEmitter.clear()
    emitter.clear()
  })

  return {
    server,
    scope,
    url: server.http.url,
    api,
    connection,
    eventByDir: {
      on: dirEmitter.on.bind(dirEmitter),
      listen: dirEmitter.listen.bind(dirEmitter),
    },
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
    },
  }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const useServerSDK = () => {
  const server = useServer()
  return server.ctx.sdk
}

type SDKEventMap = {
  [key in Event["type"]]: Extract<ServerEvent, { type: key }>
}

export type LocationContext = {
  directory: string
  event: ReturnType<typeof createGlobalEmitter<SDKEventMap>>
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): LocationContext {
  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.eventByDir.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    directory,
    event: emitter,
  }
}
