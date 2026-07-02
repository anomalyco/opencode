import { Effect, Layer } from "effect"
import { MCP } from "@opencode-ai/core/mcp/index"

export const emptyMcpLayer = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    servers: () => Effect.succeed([]),
    tools: () => Effect.succeed([]),
    callTool: () => Effect.die("unused mcp.callTool"),
    instructions: () => Effect.succeed([]),
    prompts: () => Effect.succeed([]),
    prompt: () => Effect.succeed(undefined),
    resourceCatalog: () => Effect.succeed(new MCP.ResourceCatalog({ resources: [], templates: [] })),
    readResource: () => Effect.succeed(undefined),
  }),
)
