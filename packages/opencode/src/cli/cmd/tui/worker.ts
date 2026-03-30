import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import type { Event } from "@opencode-ai/sdk/v2"
import { Flag } from "@/flag/flag"
import { setTimeout as sleep } from "node:timers/promises"
import { writeHeapSnapshot } from "node:v8"
import { RemoteAuth } from "@/server/remote-auth"
import { RemoteAccess } from "@/server/remote-access"
import { buildOrigins, buildRemoteURL, createServerPassword, preferredRemoteURL, renderQRCodeText } from "@/server/remote-pairing"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined
let remoteServer: Awaited<ReturnType<typeof Server.listen>> | undefined
let remotePassword: string | undefined
let remoteHostname = "127.0.0.1"
let remoteMode: RemoteAccess.Mode = "lan"
let remoteTunnel: RemoteAccess.Tunnel | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

async function stopRemote() {
  await remoteTunnel?.stop().catch(() => {})
  remoteTunnel = undefined
  if (remoteServer) await remoteServer.stop(true)
  remoteServer = undefined
  remotePassword = undefined
}

const startEventStream = (input: { directory: string; workspaceID?: string }) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  ;(async () => {
    while (!signal.aborted) {
      const shouldReconnect = await Instance.provide({
        directory: input.directory,
        init: InstanceBootstrap,
        fn: () =>
          new Promise<boolean>((resolve) => {
            Rpc.emit("event", {
              type: "server.connected",
              properties: {},
            } satisfies Event)

            let settled = false
            const settle = (value: boolean) => {
              if (settled) return
              settled = true
              signal.removeEventListener("abort", onAbort)
              unsub()
              resolve(value)
            }

            const unsub = Bus.subscribeAll((event) => {
              Rpc.emit("event", event as Event)
              if (event.type === Bus.InstanceDisposed.type) {
                settle(true)
              }
            })

            const onAbort = () => {
              settle(false)
            }

            signal.addEventListener("abort", onAbort, { once: true })
          }),
      }).catch((error) => {
        Log.Default.error("event stream subscribe error", {
          error: error instanceof Error ? error.message : error,
        })
        return false
      })

      if (!shouldReconnect || signal.aborted) {
        break
      }

      if (!signal.aborted) {
        await sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream({ directory: process.cwd() })

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await Config.invalidate(true)
  },
  async setWorkspace(input: { workspaceID?: string }) {
    startEventStream({ directory: process.cwd(), workspaceID: input.workspaceID })
  },
  async remoteStart(input: {
    directory: string
    sessionID: string
    ttlSeconds?: number
    mode?: RemoteAccess.Mode
  }) {
    const mode = RemoteAccess.normalize(input.mode)
    if (remoteServer && remoteMode !== mode) {
      await stopRemote()
    }

    if (!remoteServer) {
      remoteMode = mode
      remoteHostname = RemoteAccess.resolveHost(mode)
      remotePassword = process.env.OPENCODE_SERVER_PASSWORD ? undefined : createServerPassword()
      remoteServer = await Server.listen({
        hostname: remoteHostname,
        port: 0,
        mdns: false,
        cors: [],
        passwordOverride: remotePassword,
        usernameOverride: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
        remoteMode: mode,
        remotePair: {
          directory: input.directory,
          sessionID: input.sessionID,
          ttlSeconds: input.ttlSeconds,
        },
      })
    }

    const port = remoteServer.port
    if (!port) throw new Error("Remote server started without a port")

    if (mode === "tailnet" && !remoteTunnel) {
      try {
        remoteTunnel = await RemoteAccess.start({ hostname: remoteHostname, port })
      } catch (error) {
        await stopRemote()
        throw error
      }
    }

    const pairing = RemoteAuth.create({
      directory: input.directory,
      sessionID: input.sessionID,
      ttlSeconds: input.ttlSeconds,
    })
    const accessURLs = remoteTunnel ? [remoteTunnel.url] : buildOrigins(remoteHostname, port, false, undefined)
    const pairingURLs = accessURLs.map((origin) => buildRemoteURL(origin, pairing))
    const qr = await renderQRCodeText(preferredRemoteURL(pairingURLs))

    return {
      directory: input.directory,
      sessionID: input.sessionID,
      expiresAt: pairing.expiresAt,
      generatedPassword: remotePassword,
      accessURLs,
      pairingURLs,
      qr,
      mode,
      bind: new URL(RemoteAccess.origin({ hostname: remoteHostname, port })).host,
    }
  },
  async remoteStop() {
    await stopRemote()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Instance.disposeAll()
    await stopRemote()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
