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

export async function scanLlamaSwap(timeoutMs = 4000): Promise<Array<LocalLlamaSwapService & { models: string[] }>> {
  const bonjour = new Bonjour()
  const raw: LocalLlamaSwapService[] = []

  await new Promise<void>((resolve) => {
    const browser = bonjour.find({ type: "llamaswap", protocol: "tcp" })
    browser.on("up", (svc) => {
      const host = svc.host ?? svc.referer?.address ?? svc.addresses?.[0] ?? ""
      if (!host) return
      const baseURL = `http://${host}:${svc.port}/v1`
      raw.push({ name: svc.name, host, port: svc.port, baseURL })
    })
    setTimeout(() => {
      browser.stop()
      bonjour.destroy()
      resolve()
    }, timeoutMs)
  })

  return Promise.all(raw.map(async (svc) => ({ ...svc, models: await probeModelIDs(svc.baseURL) })))
}
