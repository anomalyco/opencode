import dns from "dns/promises"
import net from "net"
import os from "os"
import Bonjour from "bonjour-service"
import { createClient } from "./llama-skein/gen/client"
import { LlamaSkeinClient } from "./llama-skein/gen/sdk.gen"

export interface LocalLlamaSwapService {
  name: string
  host: string
  port: number
  baseURL: string
  // How this service was found. mDNS carries the machine's own advertised
  // identity (TXT host) and is authoritative; "lan" names come from reverse
  // DNS, which routers frequently get wrong (stale DHCP lease names).
  source: "mdns" | "localhost" | "lan"
}

// Always resolves — uses setTimeout so it works even when fetch/AbortController
// doesn't properly abort (e.g. Bun's fetch on unreachable/non-HTTP hosts).
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer))
  })
}

function normalizeHostname(host: string): string {
  return host
    .replace(/\.localdomain\.?$/, "")
    .replace(/\.local\.?$/, "")
    .replace(/\.$/, "")
}

async function reverseHostname(ip: string): Promise<string> {
  return withTimeout(
    dns.reverse(ip).then((hosts) => normalizeHostname(hosts[0] ?? ip)),
    500,
    ip,
  )
}

function normalizeControlBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")
}

function llamaSkeinClient(baseURL: string) {
  return new LlamaSkeinClient({ client: createClient({ baseUrl: normalizeControlBaseURL(baseURL) }) })
}

type ModelListResult = {
  data?: { data?: Array<{ id?: string; default?: boolean }> }
  error?: unknown
}

export type ModelProbeResult = {
  ids: string[]
  defaultModel: string | null
}

export async function probeModelIDs(baseURL: string, timeoutMs = 2000): Promise<ModelProbeResult | null> {
  return withTimeout(
    llamaSkeinClient(baseURL)
      .listModels()
      .then((result) => {
        const response = result as ModelListResult
        if (response.error !== undefined || !response.data?.data) return null
        const models = response.data.data
        const ids = models.map((m) => m.id).filter((id): id is string => Boolean(id))
        const defaultEntry = models.find((m) => m.default)
        return { ids, defaultModel: defaultEntry?.id ?? null }
      })
      .catch(() => null),
    timeoutMs,
    null,
  )
}

const LOCAL_PORTS = [11434, 11435, 8080, 8081]
const LLAMA_SWAP_SERVICE_TYPES = ["llamaswap", "llama-swap"]
const IPV4_RE = /^\d+\.\d+\.\d+\.\d+$/

// Resolve a service's address from its OWN advertised A records, preferring one
// on a subnet this machine is attached to. The packet source (referer) is only
// a fallback: Bonjour sleep proxies and multi-homed responders can deliver
// another machine's records from an unrelated source address, and using that
// address binds the advertised name to the wrong host.
function pickServiceHost(svc: {
  addresses?: string[]
  referer?: { address?: string }
  host?: string
}): string {
  const advertised = (svc.addresses ?? []).filter((item) => IPV4_RE.test(item))
  const prefixes = getLANInterfaces().prefixes
  const onLAN = advertised.find((item) => prefixes.includes(item.split(".").slice(0, 3).join(".")))
  if (onLAN) return onLAN
  const referer = svc.referer?.address
  if (referer && IPV4_RE.test(referer)) return referer
  return advertised[0] ?? svc.host ?? ""
}

async function probeHost(
  host: string,
  port: number,
  source: LocalLlamaSwapService["source"],
): Promise<LocalLlamaSwapService | null> {
  const baseURL = `http://${host}:${port}/v1`
  return withTimeout(
    llamaSkeinClient(baseURL)
      .listModels()
      .then((result) => {
        const response = result as ModelListResult
        if (response.error !== undefined || !response.data?.data) return null
        return { name: host, host, port, baseURL, source } satisfies LocalLlamaSwapService
      })
      .catch(() => null),
    1000,
    null,
  )
}

async function probeLocalhost(): Promise<LocalLlamaSwapService[]> {
  const hostname = normalizeHostname(os.hostname())
  const results = await Promise.all(
    LOCAL_PORTS.map(async (port) => {
      const svc = await probeHost("127.0.0.1", port, "localhost")
      if (!svc) return null
      return { ...svc, name: hostname }
    }),
  )
  return results.filter((r): r is LocalLlamaSwapService => r !== null)
}

function getLANInterfaces(): { prefixes: string[]; ownIPs: Set<string> } {
  const prefixes = new Set<string>()
  const ownIPs = new Set<string>()
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== "IPv4") continue
      ownIPs.add(iface.address)
      if (iface.internal) continue
      const parts = iface.address.split(".")
      if (parts.length !== 4) continue
      const [a, b] = parts.map(Number)
      // Only private RFC-1918 ranges
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        prefixes.add(parts.slice(0, 3).join("."))
      }
    }
  }
  return { prefixes: [...prefixes], ownIPs }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}

// Common llama-swap ports in the local fleet. mDNS is the primary discovery
// path; LAN probing is only a bounded fallback for machines that do not
// advertise.
const LAN_PORTS = [8080, 8081, 1234, 11434, 11435]
const LAN_PROBE_TIMEOUT_MS = 200
// Must cover .1-.254 with enough workers to reach high addresses such as .219
// before the HTTP scan returns to /connect.
const LAN_SCAN_BUDGET_MS = 3_500
const LAN_SCAN_CONCURRENCY = 192

async function tcpConnects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    // Explicit setTimeout so destroy() fires reliably even before ARP resolves.
    const timer = setTimeout(() => finish(false), LAN_PROBE_TIMEOUT_MS)
    socket.once("connect", () => {
      clearTimeout(timer)
      finish(true)
    })
    socket.once("error", () => {
      clearTimeout(timer)
      finish(false)
    })
    socket.connect(port, host)
  })
}

async function probeLAN(): Promise<LocalLlamaSwapService[]> {
  const { prefixes, ownIPs } = getLANInterfaces()
  if (prefixes.length === 0) return []

  // Phase 1: TCP-probe all candidates via net.Socket (reliable abort on unreachable hosts).
  // Skip every own IP, not one per subnet — a dual-homed machine (Wi-Fi +
  // Ethernet on the same subnet) must not discover itself through its second
  // interface and get named by reverse DNS.
  const candidates: Array<{ host: string; port: number }> = []
  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const host = `${prefix}.${i}`
      if (ownIPs.has(host)) continue
      for (const port of LAN_PORTS) {
        candidates.push({ host, port })
      }
    }
  }

  const tcpTasks = candidates.map(
    ({ host, port }) =>
      () =>
        tcpConnects(host, port).then((ok) => (ok ? { host, port } : null)),
  )
  const tcpResults = await runWithConcurrency(tcpTasks, LAN_SCAN_CONCURRENCY)
  const reachable = tcpResults.filter((r): r is { host: string; port: number } => r !== null)

  // Phase 2: HTTP-probe only the hosts that answered TCP
  const httpResults = await Promise.all(reachable.map(({ host, port }) => probeHost(host, port, "lan")))
  const found = httpResults.filter((r): r is LocalLlamaSwapService => r !== null)

  // Resolve hostnames — only ~3-4 live hosts, so 500ms DNS is fine
  return Promise.all(found.map(async (svc) => ({ ...svc, name: await reverseHostname(svc.host) })))
}

// scanMDNSOnly listens for _llamaswap._tcp mDNS announcements for timeoutMs and
// returns the raw services found — no localhost/LAN fallback, no model probing.
// Useful for verifying that llama-skein mDNS advertisement is working on the LAN.
export async function scanMDNSOnly(timeoutMs = 4000): Promise<LocalLlamaSwapService[]> {
  const found: LocalLlamaSwapService[] = []
  await new Promise<void>((resolve) => {
    let bonjour: InstanceType<typeof Bonjour> | undefined
    try {
      bonjour = new Bonjour()
      const browsers = LLAMA_SWAP_SERVICE_TYPES.map((type) => bonjour!.find({ type, protocol: "tcp" }))
      for (const browser of browsers) {
        browser.on("up", (svc) => {
          const host = pickServiceHost(svc)
          if (!host) return
          const baseURL = `http://${host}:${svc.port}/v1`
          const name = normalizeHostname((svc.txt as Record<string, string> | undefined)?.host ?? svc.name)
          found.push({ name, host, port: svc.port, baseURL, source: "mdns" })
        })
      }
      setTimeout(() => {
        try {
          for (const browser of browsers) browser.stop()
          bonjour?.destroy()
        } catch {}
        resolve()
      }, timeoutMs)
    } catch {
      resolve()
    }
  })
  return found
}

export async function scanLlamaSwap(
  timeoutMs = 4000,
): Promise<Array<LocalLlamaSwapService & { models: string[]; defaultModel: string | null; online: boolean }>> {
  const raw: LocalLlamaSwapService[] = []

  const mdnsScan = new Promise<void>((resolve) => {
    let bonjour: InstanceType<typeof Bonjour> | undefined
    let closed = false
    try {
      bonjour = new Bonjour()
      const browsers = LLAMA_SWAP_SERVICE_TYPES.map((type) => bonjour!.find({ type, protocol: "tcp" }))
      for (const browser of browsers) {
        browser.on("up", (svc) => {
          if (closed) return
          const host = pickServiceHost(svc)
          if (!host) return
          const baseURL = `http://${host}:${svc.port}/v1`
          const name = normalizeHostname((svc.txt as Record<string, string> | undefined)?.host ?? svc.name)
          raw.push({ name, host, port: svc.port, baseURL, source: "mdns" })
        })
      }
      // Yield to I/O before closing: any "up" packets that arrived just as the
      // timer fires are still in the callback queue. The setImmediate runs after
      // I/O callbacks, so they get a chance to push into raw before we close.
      setTimeout(() => {
        setImmediate(() => {
          closed = true
          try {
            for (const browser of browsers) browser.stop()
            bonjour?.destroy()
          } catch {
            // ignore cleanup errors
          }
          resolve()
        })
      }, timeoutMs)
    } catch {
      // mDNS not available (socket permissions, sandbox, etc.) — skip silently
      resolve()
    }
  })

  const [, localHits, lanHits] = await Promise.all([
    mdnsScan,
    probeLocalhost(),
    withTimeout(probeLAN(), Math.min(LAN_SCAN_BUDGET_MS, timeoutMs), []),
  ])

  // Merge hits, deduplicating by name (primary) and host:port (fallback).
  // mDNS results are preferred — a machine discovered via mDNS should not also
  // appear as a localhost or LAN hit.
  const seenNames = new Set(raw.map((s) => s.name.toLowerCase()))
  const seenHostPorts = new Set(raw.map((s) => `${s.host}:${s.port}`))
  for (const hit of [...localHits, ...lanHits]) {
    if (seenNames.has(hit.name.toLowerCase())) continue
    const key = `${hit.host}:${hit.port}`
    if (seenHostPorts.has(key)) continue
    seenNames.add(hit.name.toLowerCase())
    seenHostPorts.add(key)
    raw.push(hit)
  }

  return Promise.all(
    raw.map(async (svc) => {
      const probe = await probeModelIDs(svc.baseURL, 750)
      return { ...svc, models: probe?.ids ?? [], defaultModel: probe?.defaultModel ?? null, online: probe !== null }
    }),
  )
}
