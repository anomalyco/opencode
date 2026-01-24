import { z } from "zod"

export namespace RemoteDiscovery {
  export const AgentInfo = z.object({
    name: z.string(),
    description: z.string().optional(),
    endpoint: z.string(),
  })
  export type AgentInfo = z.infer<typeof AgentInfo>

  export const DiscoveryDocument = z.object({
    version: z.string(),
    agents: z.array(AgentInfo),
  })
  export type DiscoveryDocument = z.infer<typeof DiscoveryDocument>

  const cache = new Map<string, { doc: DiscoveryDocument; expiresAt: number }>()
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  export function parseAgentRef(ref: string): { domain: string; agentName: string } | null {
    if (!ref.startsWith("@")) return null

    const rest = ref.slice(1)

    // Check if it looks like a domain (has a dot or is localhost with optional port)
    // Domain pattern: localhost, localhost:3000, example.com, example.com:8080
    const domainPattern = /^(localhost(:\d+)?|[\w.-]+\.\w+(:\d+)?)$/

    // Check for agent name after slash: @domain.com/agent or @localhost:3000/agent
    const slashIndex = rest.indexOf("/")
    if (slashIndex !== -1) {
      const domain = rest.slice(0, slashIndex)
      const agentName = rest.slice(slashIndex + 1) || "default"
      if (!domainPattern.test(domain)) return null
      return { domain, agentName }
    }

    // Just @domain.com or @localhost:3000 (default agent)
    if (!domainPattern.test(rest)) return null
    return { domain: rest, agentName: "default" }
  }

  export async function discover(domain: string): Promise<DiscoveryDocument> {
    const cached = cache.get(domain)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.doc
    }

    const protocol = domain.startsWith("localhost") ? "http" : "https"
    const url = `${protocol}://${domain}/.well-known/agents/agents.json`

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch agent discovery from ${url}: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const parsed = DiscoveryDocument.safeParse(data)

    if (!parsed.success) {
      throw new Error(`Invalid agent discovery document from ${url}: ${parsed.error.message}`)
    }

    cache.set(domain, { doc: parsed.data, expiresAt: Date.now() + CACHE_TTL })
    return parsed.data
  }

  export async function getAgent(domain: string, agentName: string): Promise<AgentInfo & { domain: string }> {
    const doc = await discover(domain)
    const agent = doc.agents.find((a) => a.name === agentName)
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found on ${domain}. Available: ${doc.agents.map((a) => a.name).join(", ")}`)
    }
    return { ...agent, domain }
  }

  export function buildEndpointUrl(domain: string, endpoint: string): string {
    const protocol = domain.startsWith("localhost") ? "http" : "https"
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
      return endpoint
    }
    return `${protocol}://${domain}${endpoint}`
  }

  export function clearCache() {
    cache.clear()
  }
}
