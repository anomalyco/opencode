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

type ServerEventMap = { [Type in ServerEvent["type"]]: Extract<ServerEvent, { type: Type }> }
type ServerEventEmitter = ReturnType<typeof createGlobalEmitter<ServerEventMap>>
type ServerLocationEventEmitter = ReturnType<typeof createGlobalEmitter<{ [directory: string]: ServerEvent }>>
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
  event: {
    on: ServerEventEmitter["on"]
    listen: ServerEventEmitter["listen"]
    location: {
      on: ServerLocationEventEmitter["on"]
    }
  }
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const api = createApiForServer({ server: server.http, fetch: platform.fetch })
  const emitter = createGlobalEmitter<ServerEventMap>()
  const locations = createGlobalEmitter<{ [directory: string]: ServerEvent }>()

  const connection = createClientConnection(api, {
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(event) {
      const adapted = adaptServerEvent(event)
      emitter.emit(adapted.type, adapted)
      const directory = event.location?.directory
      if (directory) locations.emit(directory, adapted)
    },
    log: {
      info(message, data) {
        if (message !== "event stream disconnected") return
        console.info("[global-sdk] event stream disconnected", { url: server.http.url, ...data })
      },
    },
  })

  onCleanup(() => {
    emitter.clear()
    locations.clear()
  })

  return {
    server,
    scope,
    url: server.http.url,
    api,
    connection,
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
      location: {
        on: locations.on.bind(locations),
      },
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

export type DirectorySDK = {
  scope: ServerScope
  directory: string
  api: ServerApi
  event: ReturnType<typeof createGlobalEmitter<SDKEventMap>>
  readonly url: string
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): DirectorySDK {
  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.location.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    scope: serverSDK.scope,
    directory,
    api: serverSDK.api,
    event: emitter,
    get url() {
      return serverSDK.url
    },
  }
}
