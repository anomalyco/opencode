import { Log } from "@/util/log"
import { AsyncQueue } from "@/util/queue"
import { abortAfterAny } from "@/util/abort"
import { Bonjour, type Service } from "bonjour-service"

const log = Log.create({ service: "mdns.client" })

type Duration = number

export interface DiscoveredServer {
  name: string
  host: string
  port: number
  fullUrl: string
  txt: Record<string, string>
}

export async function find(abort: AbortSignal, idle_timeout: Duration = 200): Promise<DiscoveredServer[]> {
  const bonjour = new Bonjour()
  const queue = new AsyncQueue<DiscoveredServer>()
  const list: DiscoveredServer[] = []
  const seen = new Set<string>()
  let done = false

  const onService = (service: Service) => {
    if (done || abort.aborted) return
    if (!service.name.startsWith("opencode-")) return

    const host = service.host
    const port = service.port
    const key = `${service.name}:${host}:${port}`
    if (seen.has(key)) return

    seen.add(key)
    queue.push({
      name: service.name,
      host,
      port,
      fullUrl: `http://${host}:${port}`,
      txt: service.txt ?? {},
    })

    log.debug("discovered server", { name: service.name, host, port })
  }

  const browser = bonjour.find({ type: "http", protocol: "tcp" }, onService)

  try {
    while (true) {
      const timer = abortAfterAny(idle_timeout, abort)
      const server = await nextUntilAbort(queue, timer.signal).finally(() => timer.clearTimeout())
      if (!server) return list
      list.push(server)
    }
  } finally {
    done = true
    browser.stop()
    bonjour.destroy()
    log.info("discovery complete", { count: seen.size })
  }
}

/** Waits for the next queue item, or returns when aborted. */
async function nextUntilAbort<T>(queue: AsyncQueue<T>, abort: AbortSignal): Promise<T | undefined> {
  if (abort.aborted) return
  return new Promise((resolve) => {
    const onAbort = () => {
      abort.removeEventListener("abort", onAbort)
      resolve(undefined)
    }
    abort.addEventListener("abort", onAbort, { once: true })
    queue.next().then((item) => {
      abort.removeEventListener("abort", onAbort)
      resolve(item)
    })
  })
}
