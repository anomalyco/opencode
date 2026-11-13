import { createServer, type Socket } from "node:net"
import { hostname } from "node:os"
import { Schema } from "effect"
import { announce } from "./mdns"

/** The DNS-SD service type, `_opencode._tcp`. */
export const SERVICE_TYPE = "opencode"

// A TCP listener reports its address as an object with the port the system picked.
const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))

/**
 * Advertises this machine as `_opencode._tcp` over mDNS (`mdns.ts`), pointing at a TCP listener on a port the system picks, so
 * the OpenCode app on a nearby phone can list it. A phone that connects runs the code exchange in `exchange.ts`, which
 * this machine starts by sending `hello`; nothing it could pair with is sent before the user confirms on both devices.
 */
export async function advertise(input: {
  /** A stable id for this install, so a phone can tell machines with the same name apart. */
  id: string
  version: string
  onConnection: (socket: Socket) => void
  onError: (error: Error) => void
  /** A system responder that could not announce, before the next one is tried. */
  onFallback?: (backend: string, error: Error) => void
}) {
  const listener = await listen(input.onConnection)
  listener.server.on("error", input.onError)

  const announcement = {
    name: computerName(),
    type: SERVICE_TYPE,
    port: listener.port,
    txt: { v: "1", id: input.id, version: input.version },
  }

  try {
    const announced = await announce(announcement, { onError: input.onError, onFallback: input.onFallback })

    return {
      backend: announced.backend,
      stop: async () => {
        listener.server.close()
        await announced.stop()
      },
    }
  } catch (cause) {
    // A refused start leaves no port open.
    listener.server.close()
    throw cause
  }
}

/** How this machine introduces itself to nearby devices. */
export function computerName() {
  return `OpenCode on ${hostname().replace(/\.local$/, "")}`
}

/** Listens on every interface, on a port the system picks, handing each connection to `onConnection`. */
export async function listen(onConnection: (socket: Socket) => void) {
  const server = createServer(onConnection)

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, () => {
      server.off("error", reject)
      resolve(decodeAddress(server.address()).port)
    })
  })

  return { server, port }
}
