import { Effect, Layer, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./location"

export const emptyMcpLayer = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    transform: () => Effect.die("unused mcp.transform"),
    reload: () => Effect.die("unused mcp.reload"),
    servers: () => Effect.succeed([]),
    add: () => Effect.die("unused mcp.add"),
    connect: () => Effect.die("unused mcp.connect"),
    disconnect: () => Effect.die("unused mcp.disconnect"),
    remove: () => Effect.die("unused mcp.remove"),
    tools: () => Effect.succeed([]),
    callTool: () => Effect.die("unused mcp.callTool"),
    instructions: () => Effect.succeed([]),
    prompts: () => Effect.succeed([]),
    prompt: () => Effect.undefined,
    resourceCatalog: () => Effect.succeed(MCP.ResourceCatalog.make({ resources: [], templates: [] })),
    readResource: () => Effect.undefined,
  }),
)

export const emptyConfigLayer = Config.testLayer()

export const testLocationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)
