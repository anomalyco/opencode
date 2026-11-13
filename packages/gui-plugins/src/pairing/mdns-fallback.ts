import { Bonjour } from "bonjour-service"
import type { Backend } from "./mdns"

/**
 * Answers mDNS on port 5353 from this process, for a system without a responder of its own. It also announces this
 * machine's host name, which clashes with a responder that does exist, so it is only the last resort.
 */
export const fallback: Backend = {
  name: "bonjour-service",
  announce: async (announcement, onError) => {
    const bonjour = new Bonjour({}, onError)
    bonjour
      .publish({ name: announcement.name, type: announcement.type, port: announcement.port, txt: { ...announcement.txt } })
      .on("error", onError)

    return {
      backend: "bonjour-service",
      stop: () => new Promise<void>((resolve) => bonjour.unpublishAll(() => bonjour.destroy(() => resolve()))),
    }
  },
}
