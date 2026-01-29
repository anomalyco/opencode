import { Config } from "../config/config"
import { Log } from "../util/log"
import { fetchAgentCard } from "./agent-card"
import type { AgentCard } from "@a2a-js/sdk"

const log = Log.create({ service: "a2a.discovery" })

export interface DiscoveredAgent {
  domain: string
  card: AgentCard
}

export async function getDiscoverableDomains(): Promise<string[]> {
  const config = await Config.get()
  const domains = new Set<string>()

  // Get domains from permission.remote_agent with "allow" action
  if (config.permission?.remote_agent) {
    const permissionConfig = config.permission.remote_agent
    if (typeof permissionConfig === "object") {
      for (const [pattern, action] of Object.entries(permissionConfig)) {
        // Only auto-discover explicitly allowed domains (not wildcards)
        if (action === "allow" && !pattern.includes("*")) {
          domains.add(pattern)
        }
      }
    }
  }

  // Also include legacy remoteAgents.domains
  for (const domain of config.remoteAgents?.domains ?? []) {
    domains.add(domain)
  }

  return Array.from(domains)
}

export async function discoverAgents(): Promise<DiscoveredAgent[]> {
  const domains = await getDiscoverableDomains()
  const discovered: DiscoveredAgent[] = []

  await Promise.all(
    domains.map(async (domain) => {
      try {
        const card = await fetchAgentCard(`@${domain}`)
        discovered.push({ domain, card })
        log.info("discovered remote agent", { domain, name: card.name })
      } catch (err) {
        log.warn("failed to discover remote agent", { domain, error: String(err) })
      }
    }),
  )

  return discovered
}
