import { Bonjour } from "bonjour-service"

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

    service.on("error", () => {})

    currentPort = port
  } catch {
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
    } catch {}
    bonjour = undefined
    currentPort = undefined
  }
}

export * as MDNS from "./mdns"
