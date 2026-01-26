import { create } from "zustand"
import { useConnections } from "./connections"
import type { Agent, Command } from "../lib/sdk"

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  limit?: { context: number; output: number }
}

export interface Provider {
  id: string
  name: string
  connected: boolean
  models: ProviderModel[]
}

interface ModelSelection {
  providerID: string
  modelID: string
}

interface CatalogState {
  agents: Agent[]
  commands: Command[]
  providers: Provider[]
  defaults: Record<string, string>
  // Current selections
  agent: string // agent name, e.g. "build"
  model: ModelSelection | null
  loaded: boolean

  // Actions
  load: () => Promise<void>
  setAgent: (name: string) => void
  setModel: (selection: ModelSelection | null) => void
  cycleAgent: (direction?: 1 | -1) => void
}

export const useCatalog = create<CatalogState>((set, get) => ({
  agents: [],
  commands: [],
  providers: [],
  defaults: {},
  agent: "",
  model: null,
  loaded: false,

  load: async () => {
    const client = useConnections.getState().client
    if (!client) return

    const [agentResult, commandResult, providerResult] = await Promise.all([
      client.agent.list().catch(() => [] as Agent[]),
      client.command.list().catch(() => [] as Command[]),
      client.provider.list().catch(() => null),
    ])

    const agents = Array.isArray(agentResult) ? agentResult : []
    const commands = Array.isArray(commandResult) ? commandResult : []

    // Parse provider response: { all: [...], default: {...}, connected: [...] }
    const raw = providerResult
    const connected = new Set(Array.isArray(raw?.connected) ? raw.connected : [])
    const defaults = raw?.default || {}
    const providers: Provider[] = Array.isArray(raw?.all)
      ? raw.all
          .filter((p) => connected.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name || p.id,
            connected: connected.has(p.id),
            models: Object.values(p.models || {})
              .filter((m) => m.status !== "deprecated")
              .map((m) => ({
                id: m.id,
                name: m.name || m.id,
                reasoning: m.reasoning ?? false,
                attachment: m.attachment ?? false,
                limit: m.limit,
              })),
          }))
          .filter((p) => p.models.length > 0)
      : []

    console.log(
      "[catalog] loaded:",
      agents.length,
      "agents,",
      commands.length,
      "commands,",
      providers.length,
      "providers (" + providers.reduce((n, p) => n + p.models.length, 0) + " models)",
    )

    // Filter out hidden agents
    const visible = agents.filter((a) => !a.hidden)

    // Default agent
    const current = get().agent
    const agent = current && visible.some((a) => a.name === current) ? current : visible[0]?.name || "build"

    // Default model: use default agent's model, or first connected provider's default model
    const existing = get().model
    const fallback = (() => {
      const defaultAgent = visible[0]
      if (defaultAgent?.model) return defaultAgent.model
      for (const p of providers) {
        const defaultModelID = defaults[p.id]
        const match = defaultModelID ? p.models.find((m) => m.id === defaultModelID) : p.models[0]
        if (match) return { providerID: p.id, modelID: match.id }
      }
      return null
    })()
    const model = existing || fallback

    set({ agents: visible, commands, providers, defaults, agent, model, loaded: true })
  },

  setAgent: (name) => {
    const match = get().agents.find((a) => a.name === name)
    if (!match) return
    const model = match.model || get().model
    set({ agent: name, model })
  },

  setModel: (selection) => set({ model: selection }),

  cycleAgent: (direction = 1) => {
    const { agents, agent } = get()
    const primary = agents.filter((a) => a.mode === "primary" || a.mode === "all")
    if (primary.length < 2) return
    const idx = primary.findIndex((a) => a.name === agent)
    const next = (idx + direction + primary.length) % primary.length
    get().setAgent(primary[next].name)
  },
}))
