import type { ToolDefinition } from "@opencode-ai/plugin"

export type ToolEntry = {
  id: string
  def: ToolDefinition
}

export type ProviderInput = {
  intent?: string
  model?: string
}

export type ProviderResult = {
  providerID: string
  modelID: string
}

export type ProviderEntry = {
  id: string
  resolve(input: ProviderInput): ProviderResult | Promise<ProviderResult>
}

export type SessionHook = {
  before?(input: { sessionID: string; message: string }): void | Promise<void>
  after?(input: { sessionID: string; message: string; output: string }): void | Promise<void>
}

export type PolicyInput = {
  action: "read" | "write"
  name: string
}

export type PolicyResult = {
  allowed: boolean
  reason?: string
}

export type PolicyEntry = {
  id: string
  check(input: PolicyInput): PolicyResult | Promise<PolicyResult>
}

const providers = new Map<string, ProviderEntry>()
const tools = new Map<string, ToolEntry>()
const hooks = new Map<string, SessionHook>()
const policies = new Map<string, PolicyEntry>()

const list = <T>(map: Map<string, T>) => [...map.values()]

async function check(input: PolicyInput) {
  const items = list(policies)
  const base: PolicyResult = { allowed: true }
  return items.reduce(async (prev, item) => {
    const res = await prev
    if (!res.allowed) return res
    return item.check(input)
  }, Promise.resolve(base))
}

export const Registry = {
  providers: {
    register(entry: ProviderEntry) {
      providers.set(entry.id, entry)
    },
    get(id: string) {
      return providers.get(id)
    },
    list() {
      return list(providers)
    },
  },
  tools: {
    register(entry: ToolEntry) {
      tools.set(entry.id, entry)
    },
    get(id: string) {
      return tools.get(id)
    },
    list() {
      return list(tools)
    },
  },
  session: {
    register(entry: SessionHook) {
      hooks.set(crypto.randomUUID(), entry)
    },
    list() {
      return list(hooks)
    },
  },
  policies: {
    register(entry: PolicyEntry) {
      policies.set(entry.id, entry)
    },
    get(id: string) {
      return policies.get(id)
    },
    list() {
      return list(policies)
    },
    check,
  },
}
