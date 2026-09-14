import type { McpApi } from "@opencode/client/promise/api"
import type { Mcp } from "@opencode/schema/mcp"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface MCPEditor {
  list(): readonly [string, DeepMutable<Mcp.ServerConfig>][]
  get(name: string): DeepMutable<Mcp.ServerConfig> | undefined
  set(name: string, config: Mcp.ServerConfig): void
  update(name: string, update: (config: DeepMutable<Mcp.ServerConfig>) => void): void
  remove(name: string): void
}

export interface MCPDomain extends Pick<McpApi, "list"> {
  readonly transform: Transform<MCPEditor>
  readonly reload: () => Promise<void>
}
