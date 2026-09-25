import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./location"

// Plugins may register MCP transforms at startup; with no servers there is nothing to rebuild.
export const emptyMcp = Mcp.Service.of({
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
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
  resourceCatalog: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
  resources: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
  readResource: () => Effect.undefined,
})

export const emptyMcpLayer = Layer.succeed(Mcp.Service, emptyMcp)

export const emptyConfigLayer = Config.testLayer()

export const testLocationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)
