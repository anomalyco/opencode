import { Log } from "@/util"
import { Bonjour } from "bonjour-service"

const log = Log.create({ service: "mdns" })

let bonjour: Bonjour | undefined
let currentPort: number | undefined

export function publish(port: number, domain?: string) {
  if (currentPort === port) return
  if (bonjour) unpublish()

  try {
    const host = domain ?? "opencode.local"
    const name = `opencode-${port}`
    bonjour = new Bonjour()
    const service = bonjour.publish({
      name,
      type: "http",
      host,
      port,
      txt: { path: "/" },
    })

    service.on("up", () => {
      log.info("mDNS service published", { name, port })
    })

    service.on("error", (err) => {
      log.error("mDNS service error", { error: err })
    })

    currentPort = port
  } catch (err) {
    log.error("mDNS publish failed", { error: err })
    if (bonjour) {
      try {
        bonjour.destroy()
      } catch {}
    }
    bonjour = undefined
    currentPort = undefined
  }
}

export function unpublish() {
  if (bonjour) {
    try {
      bonjour.unpublishAll()
      bonjour.destroy()
    } catch (err) {
      log.error("mDNS unpublish failed", { error: err })
    }
    bonjour = undefined
    currentPort = undefined
    log.info("mDNS service unpublished")
  }
}

export * as MDNS from "./mdns"
