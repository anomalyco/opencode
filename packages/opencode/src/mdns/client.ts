import { Log } from "@/util/log"
import { Bonjour, type Service } from "bonjour-service"

const log = Log.create({ service: "mdns.client" })

export interface DiscoveredServer {
  name: string
  host: string
  port: number
  fullUrl: string
  txt: Record<string, string>
}

export async function* find(signal?: AbortSignal): AsyncGenerator<DiscoveredServer> {
  const bonjour = new Bonjour()
  const list: DiscoveredServer[] = []
  const seen = new Set<string>()
  let done = signal?.aborted ?? false
  let wake: (() => void) | undefined

  const notify = () => {
    if (!wake) return
    wake()
    wake = undefined
  }

  const onService = (service: Service) => {
    if (done) return
    if (!service.name.startsWith("opencode-")) return

    const host = service.host
    const port = service.port
    const key = `${service.name}:${host}:${port}`
    if (seen.has(key)) return

    seen.add(key)
    list.push({
      name: service.name,
      host,
      port,
      fullUrl: `http://${host}:${port}`,
      txt: service.txt ?? {},
    })

    log.debug("discovered server", { name: service.name, host, port })
    notify()
  }

  const browser = bonjour.find({ type: "http", protocol: "tcp" }, onService)
  const onAbort = () => {
    done = true
    notify()
  }
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    while (true) {
      const server = list.shift()
      if (server) {
        yield server
        continue
      }
      if (done) return
      await new Promise<void>((resolve) => {
        wake = resolve
        if (done || list.length > 0) notify()
      })
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
    done = true
    notify()
    browser.stop()
    bonjour.destroy()
    log.info("discovery complete", { count: seen.size })
  }
}
