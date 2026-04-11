import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Platform } from "react-native"

type ZeroconfService = {
  name?: unknown
  fullName?: unknown
  host?: unknown
  port?: unknown
  addresses?: unknown
}

type ZeroconfInstance = {
  scan: (type?: string, protocol?: string, domain?: string, implType?: string) => void
  stop: (implType?: string) => void
  removeDeviceListeners: () => void
  getServices: () => Record<string, ZeroconfService>
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

type ZeroconfModule = {
  default: new () => ZeroconfInstance
  ImplType?: {
    DNSSD?: string
  }
}

export type DiscoveredServer = {
  id: string
  name: string
  host: string
  port: number
  url: string
}

type DiscoveryStatus = "idle" | "scanning" | "error"

type UseMdnsDiscoveryInput = {
  enabled: boolean
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  const next = String(error ?? "")
  return next.trim().length > 0 ? next : "Unknown discovery error"
}

function cleanHost(input: string): string {
  const trimmed = input.trim().replace(/\.$/, "")
  if (!trimmed) return ""
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isIPv4(input: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)
}

function hostTier(input: string): number {
  if (input.endsWith(".local")) return 0
  if (isIPv4(input)) {
    if (input === "127.0.0.1") return 4
    if (input.startsWith("10.") || input.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(input)) {
      return 1
    }
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(input)) {
      return 1
    }
    return 2
  }
  if (input.includes(":")) return 3
  return 2
}

function formatHostForURL(input: string): string {
  return input.includes(":") ? `[${input}]` : input
}

function isOpenCodeService(service: ZeroconfService): boolean {
  if (typeof service.name === "string" && service.name.toLowerCase().startsWith("opencode-")) {
    return true
  }

  if (typeof service.fullName === "string" && service.fullName.toLowerCase().includes("opencode-")) {
    return true
  }

  return false
}

function parseService(service: ZeroconfService): DiscoveredServer | null {
  const port = typeof service.port === "number" ? service.port : Number(service.port)
  if (!Number.isFinite(port) || port <= 0) {
    return null
  }

  const hosts = new Set<string>()

  if (typeof service.host === "string") {
    const host = cleanHost(service.host)
    if (host.length > 0) {
      hosts.add(host)
    }
  }

  if (Array.isArray(service.addresses)) {
    for (const address of service.addresses) {
      if (typeof address !== "string") continue
      const host = cleanHost(address)
      if (host.length > 0) {
        hosts.add(host)
      }
    }
  }

  const sortedHosts = [...hosts].sort((a, b) => hostTier(a) - hostTier(b))
  const host = sortedHosts[0]
  if (!host) {
    return null
  }

  const name = typeof service.name === "string" && service.name.trim().length > 0 ? service.name.trim() : host
  const fullName =
    typeof service.fullName === "string" && service.fullName.trim().length > 0
      ? service.fullName.trim()
      : `${name}:${port}`
  const url = `http://${formatHostForURL(host)}:${port}`

  return {
    id: `${fullName}|${url}`,
    name,
    host,
    port,
    url,
  }
}

export function useMdnsDiscovery(input: UseMdnsDiscoveryInput) {
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>("idle")
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryAvailable, setDiscoveryAvailable] = useState(Platform.OS !== "web")
  const startScanRef = useRef<(() => void) | null>(null)

  const refreshDiscovery = useCallback(() => {
    startScanRef.current?.()
  }, [])

  useEffect(() => {
    if (!input.enabled) {
      startScanRef.current = null
      setDiscoveredServers([])
      setDiscoveryStatus("idle")
      setDiscoveryError(null)
      return
    }

    if (Platform.OS === "web") {
      setDiscoveryAvailable(false)
      setDiscoveryStatus("idle")
      setDiscoveryError(null)
      return
    }

    let active = true
    let zeroconf: ZeroconfInstance | null = null
    let androidImplType: string | undefined

    const rebuildServices = () => {
      if (!active || !zeroconf) return
      const values = Object.values(zeroconf.getServices() ?? {})
      const next = new Map<string, DiscoveredServer>()

      for (const value of values) {
        if (!isOpenCodeService(value)) continue
        const parsed = parseService(value)
        if (!parsed) continue
        if (!next.has(parsed.url)) {
          next.set(parsed.url, parsed)
        }
      }

      setDiscoveredServers(
        [...next.values()].sort((a, b) => {
          const nameOrder = a.name.localeCompare(b.name)
          if (nameOrder !== 0) return nameOrder
          return a.url.localeCompare(b.url)
        }),
      )
    }

    const startScan = () => {
      if (!active || !zeroconf) return

      try {
        zeroconf.stop(androidImplType)
      } catch {
        // noop
      }

      try {
        zeroconf.scan("http", "tcp", "local.", androidImplType)
        setDiscoveryStatus("scanning")
        setDiscoveryError(null)
      } catch (error) {
        setDiscoveryStatus("error")
        setDiscoveryError(toErrorMessage(error))
      }
    }

    startScanRef.current = startScan

    try {
      // Expo dev builds were failing to resolve this native module through async import().
      const mod = require("react-native-zeroconf") as ZeroconfModule
      const Zeroconf = mod.default
      if (typeof Zeroconf !== "function") {
        setDiscoveryAvailable(false)
        setDiscoveryStatus("error")
        setDiscoveryError("mDNS module unavailable")
        return
      }

      zeroconf = new Zeroconf()
      androidImplType = Platform.OS === "android" ? (mod.ImplType?.DNSSD ?? "DNSSD") : undefined
      setDiscoveryAvailable(true)

      zeroconf.on("resolved", rebuildServices)
      zeroconf.on("remove", rebuildServices)
      zeroconf.on("update", rebuildServices)
      zeroconf.on("error", (error) => {
        if (!active) return
        setDiscoveryStatus("error")
        setDiscoveryError(toErrorMessage(error))
      })

      startScan()
    } catch (error) {
      if (!active) return
      setDiscoveryAvailable(false)
      setDiscoveryStatus("error")
      setDiscoveryError(toErrorMessage(error))
    }

    return () => {
      active = false
      startScanRef.current = null
      if (!zeroconf) return

      try {
        zeroconf.stop(androidImplType)
      } catch {
        // noop
      }

      try {
        zeroconf.removeDeviceListeners()
      } catch {
        // noop
      }
    }
  }, [input.enabled])

  return useMemo(
    () => ({
      discoveredServers,
      discoveryStatus,
      discoveryError,
      discoveryAvailable,
      refreshDiscovery,
    }),
    [discoveredServers, discoveryStatus, discoveryError, discoveryAvailable, refreshDiscovery],
  )
}
