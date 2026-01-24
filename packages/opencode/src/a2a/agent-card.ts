import type { AgentCard } from "@a2a-js/sdk"
import { z } from "zod"

const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  version: z.string(),
  protocolVersion: z.string(),
  capabilities: z.object({
    streaming: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    stateTransitionHistory: z.boolean().optional(),
    extensions: z.array(z.any()).optional(),
  }),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      inputModes: z.array(z.string()).optional(),
      outputModes: z.array(z.string()).optional(),
      examples: z.array(z.string()).optional(),
    }),
  ),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  provider: z
    .object({
      organization: z.string(),
      url: z.string(),
    })
    .optional(),
  securitySchemes: z.record(z.string(), z.any()).optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
})

const cache = new Map<string, { card: AgentCard; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function parseAgentRef(ref: string): { domain: string; path: string | null } | null {
  if (!ref.startsWith("@")) return null

  const rest = ref.slice(1)
  const domainPattern = /^(localhost(:\d+)?|[\w.-]+\.\w+(:\d+)?)/

  const match = rest.match(domainPattern)
  if (!match) return null

  const domain = match[0]
  const remaining = rest.slice(domain.length)

  if (remaining && remaining.startsWith("/")) {
    return { domain, path: remaining }
  }

  return { domain, path: null }
}

export function resolveAgentCardUrl(ref: string): string {
  const parsed = parseAgentRef(ref)
  if (!parsed) throw new Error(`Invalid agent reference: ${ref}`)

  const protocol = parsed.domain.startsWith("localhost") ? "http" : "https"

  if (parsed.path) {
    return `${protocol}://${parsed.domain}${parsed.path}/agent-card.json`
  }
  return `${protocol}://${parsed.domain}/.well-known/a2a/agent-card`
}

export async function fetchAgentCard(ref: string): Promise<AgentCard> {
  const url = resolveAgentCardUrl(ref)

  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.card
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${url}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const parsed = AgentCardSchema.safeParse(data)

  if (!parsed.success) {
    throw new Error(`Invalid agent card from ${url}: ${parsed.error.message}`)
  }

  cache.set(url, { card: parsed.data, expiresAt: Date.now() + CACHE_TTL })
  return parsed.data
}

export function buildEndpointUrl(agentUrl: string, endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint
  }
  const base = new URL(agentUrl)
  return `${base.origin}${endpoint}`
}

export function clearCache() {
  cache.clear()
}

export function getDomainFromAgentUrl(agentUrl: string): string {
  const url = new URL(agentUrl)
  return url.host
}
