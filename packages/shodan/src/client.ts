import type {
  ShodanHostInfo,
  ShodanSearchResult,
  ShodanSearchCount,
  ShodanDNSResult,
  ShodanAccountProfile,
  ShodanApiInfo,
  ShodanScanResult,
  ShodanClientOptions,
} from "./types.js"

const REST_BASE = "https://api.shodan.io"

export class ShodanClient {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #timeout: number

  constructor(options: ShodanClientOptions) {
    this.#apiKey = options.apiKey
    this.#baseUrl = options.baseUrl ?? REST_BASE
    this.#timeout = options.timeout ?? 30_000
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  async #get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`)
    url.searchParams.set("key", this.#apiKey)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.#timeout),
      headers: { "Accept": "application/json" },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Shodan API ${response.status}: ${body}`)
    }

    return response.json() as Promise<T>
  }

  async #post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`)
    url.searchParams.set("key", this.#apiKey)

    const response = await fetch(url.toString(), {
      method: "POST",
      signal: AbortSignal.timeout(this.#timeout),
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Shodan API ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
  }

  // ─── Search Methods ───────────────────────────────────────────────────────────

  /** Returns all services found on the given host IP. */
  host(ip: string, options: { history?: boolean; minify?: boolean } = {}): Promise<ShodanHostInfo> {
    return this.#get<ShodanHostInfo>(`/shodan/host/${ip}`, options)
  }

  /** Search Shodan using the same query syntax as the website. */
  hostSearch(
    query: string,
    options: {
      facets?: string
      page?: number
      minify?: boolean
      after?: string
    } = {},
  ): Promise<ShodanSearchResult> {
    return this.#get<ShodanSearchResult>("/shodan/host/search", { query, ...options })
  }

  /** Count hosts matching a query without consuming query credits. */
  hostCount(
    query: string,
    options: { facets?: string } = {},
  ): Promise<ShodanSearchCount> {
    return this.#get<ShodanSearchCount>("/shodan/host/count", { query, ...options })
  }

  /** Returns a list of valid search filters. */
  filters(): Promise<string[]> {
    return this.#get<string[]>("/shodan/host/search/filters")
  }

  /** Returns a list of valid search facets. */
  facets(): Promise<string[]> {
    return this.#get<string[]>("/shodan/host/search/facets")
  }

  /** Returns a list of port numbers the Shodan crawlers are looking for. */
  ports(): Promise<number[]> {
    return this.#get<number[]>("/shodan/ports")
  }

  /** Returns a list of protocols that can be used when launching an Internet scan. */
  protocols(): Promise<Record<string, string>> {
    return this.#get<Record<string, string>>("/shodan/protocols")
  }

  // ─── Scanning ────────────────────────────────────────────────────────────────

  /** Request Shodan to crawl one or more IPs. */
  scan(ips: string | string[]): Promise<ShodanScanResult> {
    const targets = Array.isArray(ips) ? ips : [ips]
    return this.#post<ShodanScanResult>("/shodan/scan", { ips: targets.join(",") })
  }

  /** Retrieve the result of a scan by ID. */
  scanResult(scanId: string): Promise<{ id: string; status: string }> {
    return this.#get(`/shodan/scan/${scanId}`)
  }

  // ─── DNS ─────────────────────────────────────────────────────────────────────

  /** Look up the IP address for the provided list of hostnames. */
  resolve(...hostnames: string[]): Promise<ShodanDNSResult> {
    return this.#get<ShodanDNSResult>("/dns/resolve", { hostnames: hostnames.join(",") })
  }

  /** Look up hostnames that have been defined for the given list of IP addresses. */
  reverseLookup(...ips: string[]): Promise<Record<string, string[]>> {
    return this.#get("/dns/reverse", { ips: ips.join(",") })
  }

  /** Get DNS information for a domain. */
  domain(domain: string, options: { history?: boolean; type?: string; page?: number } = {}): Promise<unknown> {
    return this.#get(`/dns/domain/${domain}`, options)
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  /** Get your current IP address as seen from the Internet. */
  myIp(): Promise<string> {
    return this.#get<string>("/tools/myip")
  }

  /** Get your HTTP headers. */
  httpHeaders(): Promise<Record<string, string>> {
    return this.#get("/tools/httpheaders")
  }

  /** Calculate a honeypot probability score (0 = not honeypot, 1 = honeypot). */
  honeypotScore(ip: string): Promise<number> {
    return this.#get<number>(`/labs/honeyscore/${ip}`)
  }

  // ─── Account ─────────────────────────────────────────────────────────────────

  /** Returns information about the Shodan account linked to this API key. */
  profile(): Promise<ShodanAccountProfile> {
    return this.#get<ShodanAccountProfile>("/account/profile")
  }

  /** Returns information about the API plan. */
  info(): Promise<ShodanApiInfo> {
    return this.#get<ShodanApiInfo>("/api-info")
  }

  // ─── Community Queries ───────────────────────────────────────────────────────

  communityQueries(options: { page?: number; sort?: string; order?: string } = {}): Promise<unknown> {
    return this.#get("/shodan/query", options)
  }

  searchCommunityQueries(query: string, options: { page?: number } = {}): Promise<unknown> {
    return this.#get("/shodan/query/search", { query, ...options })
  }

  popularQueryTags(size = 10): Promise<unknown> {
    return this.#get("/shodan/query/tags", { size })
  }
}
