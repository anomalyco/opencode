import type { ShodanBanner, ShodanClientOptions } from "./types.js"

const STREAM_BASE = "https://stream.shodan.io"

export type BannerCallback = (banner: ShodanBanner) => void | Promise<void>

export class ShodanStreamClient {
  readonly #apiKey: string
  readonly #baseUrl: string

  constructor(options: ShodanClientOptions) {
    this.#apiKey = options.apiKey
    this.#baseUrl = options.baseUrl ?? STREAM_BASE
  }

  async #stream(path: string, onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    const url = new URL(`${this.#baseUrl}${path}`)
    url.searchParams.set("key", this.#apiKey)

    const response = await fetch(url.toString(), {
      signal,
      headers: { "Accept": "application/json" },
    })

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "")
      throw new Error(`Shodan Stream ${response.status}: ${body}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const banner = JSON.parse(trimmed) as ShodanBanner
            await onBanner(banner)
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** Stream ALL banners that Shodan collects. Requires Enterprise plan. */
  banners(onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    return this.#stream("/shodan/banners", onBanner, signal)
  }

  /** Stream banners filtered by ASN(s). */
  bannersWithinAsns(asns: number[], onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    const path = `/shodan/asn/${asns.join(",")}`
    return this.#stream(path, onBanner, signal)
  }

  /** Stream banners filtered by country code(s). */
  bannersWithinCountries(countries: string[], onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    const path = `/shodan/countries/${countries.join(",")}`
    return this.#stream(path, onBanner, signal)
  }

  /** Stream banners filtered by specific port(s). */
  bannersOnPorts(ports: number[], onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    const path = `/shodan/ports/${ports.join(",")}`
    return this.#stream(path, onBanner, signal)
  }

  /** Stream banners discovered on all IP ranges in network alerts. */
  alerts(onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    return this.#stream("/shodan/alert", onBanner, signal)
  }

  /** Stream banners discovered on the IP range defined in a specific network alert. */
  alert(alertId: string, onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    return this.#stream(`/shodan/alert/${alertId}`, onBanner, signal)
  }

  /** Stream banners for a specific ASN. */
  asn(asn: number, onBanner: BannerCallback, signal?: AbortSignal): Promise<void> {
    return this.#stream(`/shodan/asn/${asn}`, onBanner, signal)
  }
}
