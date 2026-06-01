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
  data?: { data?: Array<{ id?: string }> }
  error?: unknown
}

export async function probeModelIDs(baseURL: string, timeoutMs = 2000): Promise<string[] | null> {
  return withTimeout(
    llamaSkeinClient(baseURL)
      .listModels()
      .then((result) => {
        const response = result as ModelListResult
        if (response.error !== undefined || !response.data?.data) return null
        return response.data.data.map((m) => m.id).filter((id): id is string => Boolean(id))
      })
      .catch(() => null),
    timeoutMs,
    null,
  )
}

const LOCAL_PORTS = [11434, 11435, 8080, 8081]
const LLAMA_SWAP_SERVICE_TYPES = ["llamaswap", "llama-swap"]

async function probeHost(host: string, port: number): Promise<LocalLlamaSwapService | null> {
  const baseURL = `http://${host}:${port}/v1`
  return withTimeout(
    llamaSkeinClient(baseURL)
      .listModels()
      .then((result) => {
        const response = result as ModelListResult
        if (response.error !== undefined || !response.data?.data) return null
        return { name: host, host, port, baseURL } satisfies LocalLlamaSwapService
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
      const svc = await probeHost("127.0.0.1", port)
      if (!svc) return null
      return { ...svc, name: hostname }
    }),
  )
  return results.filter((r): r is LocalLlamaSwapService => r !== null)
}

function getLANSubnets(): Array<{ prefix: string; ownIP: string }> {
  const subnets: Array<{ prefix: string; ownIP: string }> = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue
      const parts = iface.address.split(".")
      if (parts.length !== 4) continue
      const [a, b] = parts.map(Number)
      // Only private RFC-1918 ranges
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        subnets.push({ prefix: parts.slice(0, 3).join("."), ownIP: iface.address })
      }
    }
  }
  return subnets
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
  const subnets = getLANSubnets()
  if (subnets.length === 0) return []

  // Phase 1: TCP-probe all candidates via net.Socket (reliable abort on unreachable hosts)
  const candidates: Array<{ host: string; port: number }> = []
  for (const { prefix, ownIP } of subnets) {
    for (let i = 1; i <= 254; i++) {
      const host = `${prefix}.${i}`
      if (host === ownIP) continue
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
  const httpResults = await Promise.all(reachable.map(({ host, port }) => probeHost(host, port)))
  const found = httpResults.filter((r): r is LocalLlamaSwapService => r !== null)

  // Resolve hostnames — only ~3-4 live hosts, so 500ms DNS is fine
  return Promise.all(found.map(async (svc) => ({ ...svc, name: await reverseHostname(svc.host) })))
}

export async function scanLlamaSwap(
  timeoutMs = 4000,
): Promise<Array<LocalLlamaSwapService & { models: string[]; online: boolean }>> {
  const raw: LocalLlamaSwapService[] = []

  const mdnsScan = new Promise<void>((resolve) => {
    let bonjour: InstanceType<typeof Bonjour> | undefined
    try {
      bonjour = new Bonjour()
      const browsers = LLAMA_SWAP_SERVICE_TYPES.map((type) => bonjour!.find({ type, protocol: "tcp" }))
      for (const browser of browsers) {
        browser.on("up", (svc) => {
          const refererAddress = /^\d+\.\d+\.\d+\.\d+$/.test(svc.referer?.address ?? "")
            ? svc.referer?.address
            : undefined
          const advertisedAddress = svc.addresses?.find((item: string) => /^\d+\.\d+\.\d+\.\d+$/.test(item))
          const host = refererAddress ?? advertisedAddress ?? svc.host ?? svc.addresses?.[0] ?? ""
          if (!host) return
          const baseURL = `http://${host}:${svc.port}/v1`
          const name = normalizeHostname((svc.txt as Record<string, string> | undefined)?.host ?? svc.name)
          raw.push({ name, host, port: svc.port, baseURL })
        })
      }
      setTimeout(() => {
        try {
          for (const browser of browsers) browser.stop()
          bonjour?.destroy()
        } catch {
          // ignore cleanup errors
        }
        resolve()
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

  // Merge hits, deduplicating by host:port against mDNS results
  const seen = new Set(raw.map((s) => `${s.host}:${s.port}`))
  for (const hit of [...localHits, ...lanHits]) {
    const key = `${hit.host}:${hit.port}`
    if (!seen.has(key)) {
      seen.add(key)
      raw.push(hit)
    }
  }

  return Promise.all(
    raw.map(async (svc) => {
      const models = await probeModelIDs(svc.baseURL, 750)
      return { ...svc, models: models ?? [], online: models !== null }
    }),
  )
}
