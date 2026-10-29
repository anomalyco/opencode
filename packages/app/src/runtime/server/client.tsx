import type { OpenCodeEvent } from "@opencode/client/promise"
import { createClientConnection, createPtyClient, type ClientConnectionStatus } from "@opencode/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, on, onCleanup } from "solid-js"
import { createApiForServer, type ServerApi } from "@/runtime/server/api"
import { createMediaCache, type MediaCache } from "@/runtime/server/media"
import { setMediaBlobLoader } from "@/runtime/persistence/drafts"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "./registry"
import { createRefCountMap } from "@/runtime/server/refcount"
import { createRequestQueue } from "@/runtime/server/request-queue"
import { ServerScope } from "@/runtime/server/scope"
import { useServer } from "./current"

type OpenCodeEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export type OpenCodeEventStream = {
  on<Type extends OpenCodeEvent["type"]>(type: Type, handler: (event: OpenCodeEventMap[Type]) => void): VoidFunction
  listen(handler: (event: OpenCodeEvent) => void): VoidFunction
}

type OpenCodeEventSource = OpenCodeEventStream & {
  location(directory: string): OpenCodeEventStream
}

export function createOpenCodeEventSource() {
  const emitter = createGlobalEmitter<OpenCodeEventMap>()

  function stream(directory?: string): OpenCodeEventStream {
    return {
      on(type, handler) {
        return emitter.on(type, (event) => {
          if (directory !== undefined && event.location?.directory !== directory) return
          handler(event)
        })
      },
      listen(handler) {
        return emitter.listen((event) => {
          if (directory !== undefined && event.details.location?.directory !== directory) return
          handler(event.details)
        })
      },
    }
  }

  const event: OpenCodeEventSource = {
    ...stream(),
    location: (directory) => stream(directory),
  }

  onCleanup(() => emitter.clear())

  return {
    event,
    publish(event: OpenCodeEvent) {
      emitter.emit(event.type, event)
    },
  }
}

export type ServerConnectionStatus = ClientConnectionStatus

type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  url: string
  /** The connection the API currently uses, which a managed server's reconnect may replace. */
  http: ServerConnection.HttpBase
  api: ServerApi
  media: MediaCache
  pty: ReturnType<typeof createPtyClient>
  connection: {
    status: Accessor<ServerConnectionStatus>
    attempt: Accessor<number>
    error: Accessor<string | undefined>
  }
  event: OpenCodeEventSource
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const transport = createServerTransport({ http: server.http, fetch: platform.fetch })
  const media = createMediaCache(() => transport.api)
  const serverKey = ServerConnection.key(server)
  setMediaBlobLoader(serverKey, (uri) => media.load(uri))
  onCleanup(() => {
    setMediaBlobLoader(serverKey, undefined)
    media.dispose()
  })

  const events = createOpenCodeEventSource()
  const reconnect = resolveEndpoint(server)

  const connection = createClientConnection(transport.api, {
    reconnect: reconnect ? async (signal) => transport.update(await reconnect(signal)) : undefined,
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(event) {
      events.publish(event)
    },
    log: {
      info(message, data) {
        if (message !== "event stream disconnected") return
        const managed = server.type === "plugin" ? server.managed : !!reconnect
        console.info("[global-sdk] event stream disconnected", { url: transport.url, managed, ...data })
      },
    },
  })

  // The plugin reports a new endpoint: requests use it at once, and a connected stream moves to it now. An endpoint
  // the stream's own reconnect already moved to needs neither.
  if (server.type === "plugin") {
    createEffect(
      on(
        () => `${server.http.url}\0${server.http.password ?? ""}`,
        () => {
          if (sameEndpoint(transport.http, server.http)) return
          transport.update(server.http)
          connection.internal.resync("Server endpoint changed")
        },
        { defer: true },
      ),
    )
  }

  return {
    server,
    scope,
    get url() {
      return transport.url
    },
    get http() {
      return transport.http
    },
    get api() {
      return transport.api
    },
    media,
    get pty() {
      return transport.pty
    },
    connection,
    event: events.event,
  }
}

/**
 * Where the event stream connects after a disconnect. A plugin's server can exist before the plugin reports its
 * endpoint (a server restored from the plugin's last inventory starts on a placeholder) and can move at any time, so
 * its stream always resolves the plugin's current endpoint, through the plugin's `reconnect` when it has one then.
 */
function resolveEndpoint(
  server: ServerConnection.Any,
): ((signal: AbortSignal) => Promise<ServerConnection.HttpBase>) | undefined {
  if (server.type === "plugin") return (signal) => server.reconnect?.(signal) ?? Promise.resolve(server.http)

  if (server.type === "sidecar") return server.reconnect

  return undefined
}

function sameEndpoint(a: ServerConnection.HttpBase, b: ServerConnection.HttpBase) {
  return a.url === b.url && a.password === b.password
}

/** A server's HTTP and PTY clients, rebuilt when its endpoint changes. */
export interface ServerTransport {
  /** Rebuilds the clients for a new endpoint and returns the new API client. */
  update(http: ServerConnection.HttpBase): ServerApi
  /** The current base URL. */
  readonly url: string
  /** The current endpoint. */
  readonly http: ServerConnection.HttpBase
  /** The current API client. */
  readonly api: ServerApi
  /** The current PTY client. */
  readonly pty: ReturnType<typeof createPtyClient>
}

export function createServerTransport(input: {
  http: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerTransport {
  const queue = createRequestQueue({ fetch: input.fetch ?? globalThis.fetch })

  // Keeps the endpoint as plain values: a plugin's endpoint can be a store proxy that already reads the next password,
  // and the clients built here keep the one they started with.
  const build = (input: ServerConnection.HttpBase) => {
    const http = { url: input.url, password: input.password }
    const api = createApiForServer({ server: http, fetch: queue.fetch })

    return { http, api, pty: createPtyClient(api, { url: http.url }) }
  }

  const state = { current: build(input.http) }

  return {
    update(http: ServerConnection.HttpBase) {
      if (sameEndpoint(http, state.current.http)) return state.current.api
      state.current = build(http)

      return state.current.api
    },
    get url() {
      return state.current.http.url
    },
    get http() {
      return state.current.http
    },
    get api() {
      return state.current.api
    },
    get pty() {
      return state.current.pty
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

export type LocationContext = {
  directory: string
  event: OpenCodeEventStream
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): LocationContext {
  return {
    directory,
    event: serverSDK.event.location(directory),
  }
}
