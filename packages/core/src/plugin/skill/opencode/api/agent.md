# agent

## GET /api/agent

Retrieve currently registered agents.

Returns: `{ location: Location.PublicRef; data: Agent.Info[] }`

## GET /api/agent/{agentID}

Retrieve a single currently registered agent.

Returns: `{ location: Location.PublicRef; data: Agent.Info }`

## Types

- `Agent.Info`: `{ id, name, model, request, system, instructions, description, mode, hidden, color, steps, permissions }`
- `Location.PublicRef`: `{ directory: string }`
