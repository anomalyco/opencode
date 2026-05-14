import Bonjour from "bonjour-service"

export interface LocalLlamaSwapService {
  name: string
  host: string
  port: number
  baseURL: string
}

async function probeModelIDs(baseURL: string): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  return fetch(`${baseURL}/models`, { signal: controller.signal })
    .then((r) => (r.ok ? (r.json() as Promise<{ data?: Array<{ id: string }> }>) : null))
    .then((body) => (body?.data ?? []).map((m) => m.id).filter(Boolean))
    .catch(() => [])
    .finally(() => clearTimeout(timer))
}

const LOCAL_PORTS = [11434, 11435, 8080, 8081]

async function probeLocalhost(): Promise<LocalLlamaSwapService[]> {
  const results = await Promise.all(
    LOCAL_PORTS.map(async (port) => {
      const baseURL = `http://127.0.0.1:${port}/v1`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1000)
      return fetch(`${baseURL}/models`, { signal: controller.signal })
        .then((r) => {
          if (!r.ok) return null
          return r.json() as Promise<{ data?: unknown[] }>
        })
        .then((body) => {
          if (!body?.data) return null
          const hostname = require("os").hostname().replace(/\.local$/, "")
          return { name: hostname, host: "127.0.0.1", port, baseURL } satisfies LocalLlamaSwapService
        })
        .catch(() => null)
        .finally(() => clearTimeout(timer))
    }),
  )
  return results.filter((r): r is LocalLlamaSwapService => r !== null)
}

export async function scanLlamaSwap(timeoutMs = 4000): Promise<Array<LocalLlamaSwapService & { models: string[] }>> {
  const bonjour = new Bonjour()
  const raw: LocalLlamaSwapService[] = []

  const [, localHits] = await Promise.all([
    new Promise<void>((resolve) => {
      const browser = bonjour.find({ type: "llamaswap", protocol: "tcp" })
      browser.on("up", (svc) => {
        const host = svc.host ?? svc.referer?.address ?? svc.addresses?.[0] ?? ""
        if (!host) return
        const baseURL = `http://${host}:${svc.port}/v1`
        const name = (svc.txt as Record<string, string> | undefined)?.host ?? svc.name
        raw.push({ name, host, port: svc.port, baseURL })
      })
      setTimeout(() => {
        browser.stop()
        bonjour.destroy()
        resolve()
      }, timeoutMs)
    }),
    probeLocalhost(),
  ])

  // Merge localhost hits, deduplicating by port against mDNS results
  const mdnsPorts = new Set(raw.map((s) => s.port))
  for (const local of localHits) {
    if (!mdnsPorts.has(local.port)) raw.push(local)
  }

  return Promise.all(raw.map(async (svc) => ({ ...svc, models: await probeModelIDs(svc.baseURL) })))
}
