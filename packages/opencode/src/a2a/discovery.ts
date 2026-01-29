import { Config } from "../config/config"
import { Log } from "../util/log"
import { fetchAgentCard, requiresOAuth } from "./agent-card"
import type { AgentCard } from "@a2a-js/sdk"

const log = Log.create({ service: "a2a.discovery" })

export interface DiscoveredAgent {
  /** The agent reference (domain or domain/path) */
  ref: string
  card: AgentCard
  requiresAuth: boolean
}

/**
 * Get agent refs to auto-discover from config.
 * Supports both simple domains (vercel.com) and path-based refs (vercel.com/deploy-agent).
 */
export async function getDiscoverableAgentRefs(): Promise<string[]> {
  const config = await Config.get()
  const refs = new Set<string>()

  // Get refs from permission.remote_agent with "allow" action
  if (config.permission?.remote_agent) {
    const permissionConfig = config.permission.remote_agent
    if (typeof permissionConfig === "object") {
      for (const [pattern, action] of Object.entries(permissionConfig)) {
        // Only auto-discover explicitly allowed refs (not wildcards)
        if (action === "allow" && !pattern.includes("*")) {
          refs.add(pattern)
        }
      }
    }
  }

  // Also include legacy remoteAgents.domains
  for (const domain of config.remoteAgents?.domains ?? []) {
    refs.add(domain)
  }

  return Array.from(refs)
}

/** @deprecated Use getDiscoverableAgentRefs instead */
export const getDiscoverableDomains = getDiscoverableAgentRefs

export async function discoverAgents(): Promise<DiscoveredAgent[]> {
  const refs = await getDiscoverableAgentRefs()
  const discovered: DiscoveredAgent[] = []

  await Promise.all(
    refs.map(async (ref) => {
      try {
        const card = await fetchAgentCard(`@${ref}`)
        const requiresAuth = requiresOAuth(card)
        discovered.push({ ref, card, requiresAuth })
        log.info("discovered remote agent", {
          ref,
          name: card.name,
          requiresAuth,
        })
      } catch (err) {
        log.warn("failed to discover remote agent", { ref, error: String(err) })
      }
    }),
  )

  return discovered
}
