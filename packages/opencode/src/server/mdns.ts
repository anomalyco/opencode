import { Log } from "@/util/log"
import { Bonjour } from "bonjour-service"

const log = Log.create({ service: "mdns" })

export namespace MDNS {
  let bonjour: Bonjour | undefined
  let currentPort: number | undefined
  let currentService: any = undefined
  let upHandler: (() => void) | undefined
  let errorHandler: ((err: Error) => void) | undefined

  export function publish(port: number) {
    if (currentPort === port) return
    if (bonjour) unpublish()

    try {
      const name = `opencode-${port}`
      bonjour = new Bonjour()
      const service = bonjour.publish({
        name,
        type: "http",
        host: "opencode.local",
        port,
        txt: { path: "/" },
      })

      // Store handler references for cleanup
      upHandler = () => {
        log.info("mDNS service published", { name, port })
      }
      errorHandler = (err: Error) => {
        log.error("mDNS service error", { error: err })
      }

      service.on("up", upHandler)
      service.on("error", errorHandler)

      currentService = service
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
      currentService = undefined
      upHandler = undefined
      errorHandler = undefined
    }
  }

  export function unpublish() {
    if (currentService && upHandler && errorHandler) {
      try {
        currentService.removeListener("up", upHandler)
        currentService.removeListener("error", errorHandler)
      } catch (err) {
        log.error("mDNS listener cleanup failed", { error: err })
      }
      currentService = undefined
      upHandler = undefined
      errorHandler = undefined
    }

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
}
