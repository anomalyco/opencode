/** A DNS-SD service to announce on the local network. */
export type Announcement = {
  /** The instance name phones list, such as `OpenCode on macbook`. */
  name: string
  /** The service type without the leading underscore or protocol, such as `opencode` for `_opencode._tcp`. */
  type: string
  port: number
  txt: Readonly<Record<string, string>>
}

/** An announcement that is live until `stop`. `backend` names what holds it, for logs. */
export type Announced = { backend: string; stop: () => Promise<void> }

/** One way to hold an announcement. It rejects when it cannot, and the next backend is tried. */
export type Backend = { name: string; announce: (announcement: Announcement, onError: (error: Error) => void) => Promise<Announced> }

/**
 * Announces `announcement` through the system's own mDNS responder where there is one, so this machine keeps its own
 * host name and the system picks the network interfaces: mDNSResponder through `dns-sd` on macOS, Avahi over D-Bus on
 * Linux, and the DNS-SD API in `dnsapi.dll` on Windows. Where that responder is missing or refuses, `bonjour-service`
 * answers on port 5353 itself.
 */
export async function announce(
  announcement: Announcement,
  options: { onError: (error: Error) => void; onFallback?: (backend: string, error: Error) => void; backends?: Backend[] },
): Promise<Announced> {
  const backends = options.backends ?? (await platformBackends(process.platform))
  const failures: Error[] = []

  for (const backend of backends) {
    try {
      return await backend.announce(announcement, options.onError)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      failures.push(error)
      options.onFallback?.(backend.name, error)
    }
  }

  throw new AggregateError(failures, "no mDNS backend could announce this machine")
}

async function platformBackends(platform: NodeJS.Platform): Promise<Backend[]> {
  const fallback = (await import("./mdns-fallback")).fallback

  if (platform === "darwin") return [(await import("./mdns-darwin")).darwin, fallback]

  if (platform === "linux") return [(await import("./mdns-linux")).linux, fallback]

  if (platform === "win32") return [(await import("./mdns-windows")).windows, fallback]

  return [fallback]
}

/** TXT entries as `key=value`, the form every backend takes; keys and values may not hold `=` or be empty keys. */
export function txtEntries(txt: Announcement["txt"]) {
  return Object.entries(txt).map(([key, value]) => `${key}=${value}`)
}
