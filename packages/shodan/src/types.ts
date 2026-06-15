export interface ShodanHostInfo {
  ip_str: string
  hostnames: string[]
  domains: string[]
  country_name: string
  country_code: string
  city: string
  org: string
  asn: string
  isp: string
  os: string | null
  ports: number[]
  vulns?: string[]
  data: ShodanBanner[]
  last_update: string
  tags: string[]
}

export interface ShodanBanner {
  port: number
  transport: string
  protocol: string
  product?: string
  version?: string
  info?: string
  cpe?: string[]
  data: string
  timestamp: string
  hostnames: string[]
  domains: string[]
  location: {
    country_name: string
    country_code: string
    city: string
    latitude: number
    longitude: number
  }
  vulns?: Record<string, ShodanVuln>
}

export interface ShodanVuln {
  cvss: number
  references: string[]
  summary: string
  verified: boolean
}

export interface ShodanSearchResult {
  matches: ShodanHostInfo[]
  total: number
  facets?: Record<string, Array<{ value: string; count: number }>>
}

export interface ShodanSearchCount {
  total: number
  facets?: Record<string, Array<{ value: string; count: number }>>
}

export interface ShodanDNSResult {
  [hostname: string]: string
}

export interface ShodanExploit {
  _id: string
  description: string
  author: string
  code?: string
  date: string
  platform: string
  port?: number
  type: string
  osvdb?: string
  cve?: string[]
  bid?: string[]
  msb?: string[]
  source: string
}

export interface ShodanExploitResult {
  matches: ShodanExploit[]
  total: number
  facets?: Record<string, Array<{ value: string; count: number }>>
}

export interface ShodanAccountProfile {
  member: boolean
  credits: number
  display_name: string
  created: string
}

export interface ShodanApiInfo {
  scan_credits: number
  usage_limits: {
    scan_credits: number
    query_credits: number
    monitored_ips: number
  }
  plan: string
  https: boolean
  unlocked: boolean
  query_credits: number
  monitored_ips: number
  unlocked_left: number
  telnet: boolean
}

export interface ShodanScanResult {
  id: string
  count: number
  credits_left: number
}

export interface ShodanClientOptions {
  apiKey: string
  baseUrl?: string
  timeout?: number
}
