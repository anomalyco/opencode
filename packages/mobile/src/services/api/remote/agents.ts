import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { useActiveProjectServerUrlQuery } from "@/services/api/local/projects"

export interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  topP?: number
  temperature?: number
  model?: {
    modelID: string
    providerID: string
  }
  prompt?: string
  tools: Record<string, boolean>
}

class AgentsService {
  async getAgents(serverUrl: string): Promise<Agent[]> {
    const response = await fetch(`${serverUrl}/agent`)
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`)
    }
    return response.json()
  }
}

const agentsService = new AgentsService()

// Query hooks
export function useAgentsQuery() {
  const { data: serverUrl } = useActiveProjectServerUrlQuery()

  return useQuery({
    queryKey: queryKeys.remote.config.agents(),
    queryFn: () => agentsService.getAgents(serverUrl!),
    enabled: !!serverUrl,
    staleTime: 30 * 60 * 1000, // 30 minutes - agents rarely change
  })
}

// Helper hook to get agent names for cycling
export function useAgentNames(): string[] {
  const { data: agents } = useAgentsQuery()
  return agents?.map((agent: Agent) => agent.name) || ["general", "build", "plan", "example-driven-docs-writer"]
}

export { agentsService }
