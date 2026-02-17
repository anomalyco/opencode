import { Server } from "@/server/server"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Log } from "@/util/log"
import { Rpc } from "@/util/rpc"
import { Installation } from "@/installation"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { upgrade } from "@/cli/upgrade"
import { GlobalBus } from "@/bus/global"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: Installation.isLocal() ? "DEBUG" : "INFO",
})

process.on("uncaughtException", (e) => {
  Log.Default.error(e)
})
process.on("unhandledRejection", (e) => {
  Log.Default.error(e)
})
process.on("SIGUSR2", async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

const transport = Rpc.self()

GlobalBus.on("event", (data) => {
  Rpc.emit("global.event", data, transport)
})

const BASE_URL = "http://opencode.internal"

function errmsg(e: unknown) {
  return e instanceof Error ? e.message : e
}

async function appFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (password) {
    request.headers.set("Authorization", `Basic ${btoa(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`)}`)
  }
  return await Server.App().fetch(request)
}

function provide<T>(directory: string, fn: () => T) {
  return Instance.provide({ directory, init: InstanceBootstrap, fn })
}

const abort = new AbortController()
let listener: ReturnType<typeof Server.listen> | undefined

function startEventStream(directory: string) {
  const sdk = createOpencodeClient({
    baseUrl: BASE_URL,
    fetch: appFetch as typeof fetch,
  })
  ;(async () => {
    let backoff = 250
    while (!abort.signal.aborted) {
      const events = await Promise.resolve(sdk.event.subscribe({})).catch(() => undefined)
      if (!events) {
        await Bun.sleep(backoff)
        backoff = Math.min(backoff * 1.5, 30000)
        continue
      }
      backoff = 250

      for await (const event of events.stream) {
        Rpc.emit("event", event, transport)
      }

      await Bun.sleep(250)
    }
  })().catch((error) => {
    Log.Default.error("event stream error", { error: errmsg(error) })
  })
}

const rpc = {
  async fetch(input: { url: string; init: RequestInit & { headers: Record<string, string> } }) {
    const url = input.url.startsWith("http") ? input.url : `${BASE_URL}${input.url}`
    const response = await Server.App().fetch(new Request(url, input.init))
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    }
  },
  async server(input: {
    directory: string
    port?: number
    hostname?: string
    mdns?: boolean
  }): Promise<string | undefined> {
    startEventStream(input.directory)
    if (input.port || input.hostname || input.mdns) {
      listener = Server.listen({
        port: input.port ?? 0,
        hostname: input.hostname ?? "127.0.0.1",
        mdns: input.mdns ?? false,
      })
      return listener.url.toString()
    }
    return undefined
  },
  async checkUpgrade(input: { directory: string }) {
    return provide(input.directory, async () => {
      await upgrade().catch(() => {})
    }).catch(() => {})
  },
  async reload(_input: {}) {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async shutdown(_input: {}) {
    Log.Default.info("worker shutting down")
    abort.abort()
    await Promise.race([
      Instance.disposeAll(),
      new Promise((resolve) => {
        setTimeout(resolve, 5000)
      }),
    ])
    if (listener) listener.stop(true)
  },
}

export type WorkerRpc = typeof rpc

Rpc.listen(rpc, transport)
