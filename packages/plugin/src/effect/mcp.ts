import type { McpApi } from "@opencode-ai/client/effect/api"
import type { Mcp } from "@opencode-ai/schema/mcp"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface MCPDraft {
  list(): readonly [string, Types.DeepMutable<Mcp.ServerConfig>][]
  get(name: string): Types.DeepMutable<Mcp.ServerConfig> | undefined
  set(name: string, config: Mcp.ServerConfig): void
  update(name: string, update: (config: Types.DeepMutable<Mcp.ServerConfig>) => void): void
  remove(name: string): void
}

export interface MCPDomain extends Omit<McpApi<unknown>, "resource"> {
  readonly transform: Transform<MCPDraft>
  readonly reload: () => Effect.Effect<void>
}
