# agent

## GET /api/agent

Retrieve currently registered agents.

Returns: `{ location: Location.PublicRef; data: Agent.Info[] }`

## GET /api/agent/{agentID}

Retrieve a single currently registered agent.

Returns: `{ location: Location.PublicRef; data: Agent.Info }`

## Types

- `Agent.Info`: `{ id: string; name: string; model?: Model.Ref; request: Provider.Request; system?: string; description?: string; mode: "subagent" | "primary" | "all"; hidden: boolean; color?: string; steps?: number; permissions: Permission.Ruleset }`
- `Location.PublicRef`: `{ directory: string }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Permission.Rule`: `{ action: string; resource: string; effect: "allow" | "deny" | "ask" }`
- `Permission.Ruleset`: `Permission.Rule[]`
- `Provider.Request`: `{ settings: Provider.Settings; headers: Record<string, string>; body: Record<string, unknown> }`
- `Provider.Settings`: `Record<string, unknown>`
