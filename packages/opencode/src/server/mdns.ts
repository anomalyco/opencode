import { Bonjour } from "bonjour-service"

let bonjour: Bonjour | undefined
let currentPort: number | undefined

function logError(message: string, error: unknown) {
  console.warn(`[mdns] ${message}`, error)
}

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

    service.on("error", (error) => logError("service error", error))

    currentPort = port
  } catch (error) {
    logError("failed to publish service", error)
    if (bonjour) {
      try {
        bonjour.destroy()
      } catch (destroyError) {
        logError("failed to destroy service after publish failure", destroyError)
      }
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
    } catch (error) {
      logError("failed to unpublish service", error)
    }
    bonjour = undefined
    currentPort = undefined
  }
}

export * as MDNS from "./mdns"
