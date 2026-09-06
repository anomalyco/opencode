export * as LocationCatalog from "./location-catalog"

import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Reference } from "@opencode-ai/core/reference"
import { Shell } from "@opencode-ai/core/shell"
import { Skill } from "@opencode-ai/core/skill"
import { Effect } from "effect"

/** The public shape of an MCP server: connection status without runtime internals. */
export const mcpServers = Effect.gen(function* () {
  const mcp = yield* Mcp.Service
  const servers = yield* mcp.servers()
  return servers.map((info) => ({ name: info.name, status: info.status, integrationID: info.integrationID }))
})

/**
 * Everything a client reads to render a Location, in one concurrent pass. Each field is exactly what
 * the corresponding list endpoint returns, so clients can seed those reads from this one response.
 */
export const read = Effect.gen(function* () {
  const agent = yield* Agent.Service
  const catalog = yield* Catalog.Service
  const command = yield* Command.Service
  const form = yield* Form.Service
  const integration = yield* Integration.Service
  const mcp = yield* Mcp.Service
  const reference = yield* Reference.Service
  const shell = yield* Shell.Service
  const skill = yield* Skill.Service
  return yield* Effect.all(
    {
      agent: agent.list(),
      command: command.list(),
      integration: integration.list(),
      mcp: mcpServers,
      mcpResource: mcp.resourceCatalog(),
      model: catalog.model.available(),
      provider: catalog.provider.available(),
      reference: reference.list(),
      skill: skill.list(),
      shell: shell.list(),
      form: form.list(),
    },
    { concurrency: "unbounded" },
  )
})
