import type { Backend } from "./mdns"
import { txtEntries } from "./mdns"

const AVAHI = "org.freedesktop.Avahi"

/** `AVAHI_IF_UNSPEC` and `AVAHI_PROTO_UNSPEC`: every interface, IPv4 and IPv6, as Avahi chooses. */
const UNSPEC = -1

/** Avahi's entry group states. */
const State = { established: 2, collision: 3, failure: 4 } as const

/** How long Avahi has to establish the announcement before the next backend is tried. */
const READY_TIMEOUT = 10_000

/** A collision renames the instance this many times at most. */
const MAX_RENAMES = 10

/**
 * Avahi, the responder most Linux desktops and many servers run, over the system D-Bus: an entry group holds the
 * service while this process keeps its connection, and Avahi withdraws it when the connection closes. A clash with
 * another machine's instance takes Avahi's alternative name. With no Avahi on the bus this rejects, for the fallback.
 */
export const linux: Backend = {
  name: "avahi",
  announce: async (announcement, onError) => {
    const { default: dbus } = await import("dbus-next")
    const bus = dbus.systemBus()
    // A missing bus or daemon surfaces as an error event rather than a rejected call.
    const broken = new Promise<never>((_, reject) => bus.on("error", reject))
    broken.catch(() => undefined)

    const within = <T>(work: Promise<T>) =>
      Promise.race([
        work,
        broken,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Avahi did not establish the announcement")), READY_TIMEOUT),
        ),
      ])

    try {
      const server = (await within(bus.getProxyObject(AVAHI, "/"))).getInterface(`${AVAHI}.Server`)
      const path: string = await within(server.EntryGroupNew())
      const group = (await within(bus.getProxyObject(AVAHI, path))).getInterface(`${AVAHI}.EntryGroup`)
      const txt = txtEntries(announcement.txt).map((entry) => Buffer.from(entry, "utf8"))
      const name = { current: announcement.name, renames: 0 }

      // A name this machine already announces is refused at once, rather than reported as a collision later.
      const add = async (): Promise<void> => {
        try {
          await group.AddService(UNSPEC, UNSPEC, 0, name.current, `_${announcement.type}._tcp`, "", "", announcement.port, txt)
        } catch (cause) {
          if (!isCollision(cause) || name.renames++ >= MAX_RENAMES) throw cause
          name.current = await server.GetAlternativeServiceName(name.current)

          return add()
        }

        await group.Commit()
      }

      const established = new Promise<void>((resolve, reject) => {
        group.on("StateChanged", (state: number, error: string) => {
          if (state === State.established) return resolve()

          if (state === State.failure) return reject(new Error(`Avahi failed: ${error}`))

          if (state !== State.collision) return

          if (name.renames++ >= MAX_RENAMES) return reject(new Error("Avahi kept finding the name taken"))
          // Once live, a later clash is renamed the same way; an error then is reported, not thrown.
          void Promise.resolve()
            .then(async () => {
              name.current = await server.GetAlternativeServiceName(name.current)
              await group.Reset()
              await add()
            })
            .catch((cause: Error) => onError(cause))
        })
      })

      await within(add())
      await within(established)
      bus.on("error", onError)

      return {
        backend: "avahi",
        stop: async () => {
          await group.Free().catch(() => undefined)
          bus.disconnect()
        },
      }
    } catch (cause) {
      bus.disconnect()
      throw cause
    }
  },
}

function isCollision(cause: unknown) {
  return cause instanceof Error && "type" in cause && cause.type === `${AVAHI}.CollisionError`
}
