import type { BrowserWindow } from "electron"
import { NodeHttpClient } from "@effect/platform-node"
import { OpenCode } from "@opencode/client/effect"
import type { MainPlugin } from "@opencode/plugin/desktop/main"
import { DesktopExtension } from "@opencode/plugin/desktop/protocol"
import { createLifecycle } from "@opencode/plugin/desktop/lifecycle"
import { CallError, decode, encode } from "@opencode/plugin/desktop/rpc"
import { Effect, ManagedRuntime, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { createSurfaces } from "./surfaces"

export function createMainExtensionHost(
  plugins: readonly MainPlugin.Entry[],
  publish: (win: BrowserWindow, event: DesktopExtension.Event) => void,
  load?: (id: string) => Promise<MainPlugin.Entry | undefined>,
) {
  const windows = new Map<BrowserWindow, ReturnType<typeof windowHost>>()
  const host = (win: BrowserWindow) => {
    const previous = windows.get(win)
    if (previous) return previous
    const result = windowHost(win)
    windows.set(win, result)
    win.once("closed", () => {
      result.dispose()
      windows.delete(win)
    })
    return result
  }
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  return {
    configure(win: BrowserWindow, servers: readonly DesktopExtension.Endpoint[]) {
      host(win).configure(servers)
    },
    call(win: BrowserWindow, input: DesktopExtension.Call) {
      return host(win).call(input)
    },
    cancel(win: BrowserWindow, extensionID: string, requestID: string) {
      host(win).cancel(extensionID, requestID)
    },
    surface(win: BrowserWindow, extensionID: string, surfaceID: string, layout?: DesktopExtension.Layout) {
      host(win).surfaces.layout(extensionID, surfaceID, layout)
    },
    release(win: BrowserWindow, extensionID: string) {
      host(win).release(extensionID)
    },
    releaseAll(extensionID: string) {
      windows.forEach((host) => host.release(extensionID))
    },
    async dispose() {
      windows.forEach((value) => value.dispose())
      windows.clear()
      await runtime.dispose()
    },
  }

  function windowHost(win: BrowserWindow) {
    const servers = new Map<string, DesktopExtension.Endpoint>()
    const instances = new Map<
      string,
      {
        lifecycle: ReturnType<typeof createLifecycle>
        handlers: ReturnType<MainPlugin.Entry["setup"]>
        definition: MainPlugin.Entry
      }
    >()
    const calls = new Map<string, AbortController>()
    const surfaces = createSurfaces(win)
    const release = (extensionID: string) => {
      calls.forEach((call, key) => {
        if (key.startsWith(`${extensionID}/`)) call.abort()
      })
      const instance = instances.get(extensionID)
      instances.delete(extensionID)
      try {
        instance?.lifecycle.dispose()
      } finally {
        surfaces.release(extensionID)
      }
    }
    const instance = async (id: string) => {
      const previous = instances.get(id)
      if (previous) return previous
      const definition = plugins.find((plugin) => plugin.id === id) ?? (await load?.(id))
      if (!definition) throw new CallError("rpc.unavailable", `Desktop extension unavailable: ${id}`)
      const loaded = instances.get(id)
      if (loaded) return loaded
      const lifecycle = createLifecycle()
      const context: MainPlugin.Context = {
        window: win,
        lifecycle,
        client(serverID) {
          const endpoint = servers.get(serverID)
          if (!endpoint) return Promise.reject(new Error("Desktop server is unavailable"))
          return runtime.runPromise(
            Effect.gen(function* () {
              const http = yield* HttpClient.HttpClient
              const authorization = endpoint.password
                ? `Basic ${Buffer.from(`${endpoint.username ?? "opencode"}:${endpoint.password}`).toString("base64")}`
                : SidecarCredentials.authorization(SidecarCredentials.get(), endpoint.url)
              return yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
                Effect.provideService(
                  HttpClient.HttpClient,
                  authorization
                    ? HttpClient.mapRequest(http, HttpClientRequest.setHeader("authorization", authorization))
                    : http,
                ),
              )
            }),
          )
        },
        surfaces: { register: (view) => surfaces.register(id, view) },
        async emit(contract, name, data) {
          if (lifecycle.signal.aborted) return
          const event = contract.events[name]
          if (!event) throw new Error(`Unknown desktop event: ${name}`)
          publish(win, { extensionID: id, rpcID: contract.id, name, data: await encode(event.schema, data) })
        },
      }
      try {
        const value = { lifecycle, definition, handlers: definition.setup(context) }
        instances.set(id, value)
        return value
      } catch (error) {
        lifecycle.dispose()
        throw error
      }
    }
    return {
      surfaces,
      release,
      configure(values: readonly DesktopExtension.Endpoint[]) {
        servers.clear()
        values.forEach((server) => servers.set(server.id, server))
      },
      cancel(id: string, requestID: string) {
        calls.get(`${id}/${requestID}`)?.abort()
      },
      async call(input: DesktopExtension.Call): Promise<Schema.Json> {
        const key = `${input.extensionID}/${input.requestID}`
        const controller = new AbortController()
        calls.set(key, controller)
        try {
          const current = await instance(input.extensionID)
          controller.signal.throwIfAborted()
          const method =
            current.definition.rpc.id === input.rpcID ? current.definition.rpc.methods[input.method] : undefined
          const handler = current.handlers[input.method]
          if (!method || !handler) throw new CallError("rpc.method_not_found", "Unknown desktop extension method")
          const value = await decode(method.input, input.input).catch((error) => {
            throw new CallError("rpc.invalid_input", String(error))
          })
          const output = await handler(value, {
            signal: AbortSignal.any([controller.signal, current.lifecycle.signal]),
            error(type, message, data): never {
              throw new CallError(type, message, data)
            },
          })
          return { ok: true, output: await encode(method.output, output) }
        } catch (error) {
          return Schema.decodeUnknownSync(Schema.Json)({
            ok: false,
            error: {
              type: error instanceof CallError ? error.type : "rpc.internal",
              message: error instanceof Error ? error.message : String(error),
              ...(error instanceof CallError && error.data !== undefined
                ? { data: Schema.decodeUnknownSync(Schema.Json)(error.data) }
                : {}),
            },
          })
        } finally {
          calls.delete(key)
        }
      },
      dispose() {
        calls.forEach((call) => call.abort())
        Array.from(instances.keys()).forEach(release)
        surfaces.dispose()
      },
    }
  }
}
