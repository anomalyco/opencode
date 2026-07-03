import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./location"

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

export const emptyConfigLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({ entries: () => Effect.succeed([]) }),
)

export const testLocationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)
