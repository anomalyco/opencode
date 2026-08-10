import path from "path"
import { McpCatalog } from "@/mcp/catalog"

export const ASHBY_SERVER = "ashby"

export const ASHBY_READ_TOOLS = ["list_jobs", "get_job", "list_candidates", "get_candidate"] as const
export const ASHBY_WRITE_TOOLS = ["change_stage", "create_note"] as const

export const AshbyMockDir = path.join(import.meta.dir, "fixtures", "mcp")
export const AshbyMockScript = path.join(AshbyMockDir, "ashby-mock.ts")
export const AshbyMockData = path.join(AshbyMockDir, "ashby-data.json")

export function ashbyToolPermissionKey(tool: string) {
  return McpCatalog.toolName(ASHBY_SERVER, tool)
}

export function ashbyPermissionDefaults() {
  const permission: Record<string, "allow" | "deny"> = {}
  for (const tool of ASHBY_READ_TOOLS) {
    permission[ashbyToolPermissionKey(tool)] = "allow"
  }
  for (const tool of ASHBY_WRITE_TOOLS) {
    permission[ashbyToolPermissionKey(tool)] = "deny"
  }
  return permission
}

export function ashbyMockMcpConfig(command: string[]) {
  return {
    type: "local" as const,
    command,
    enabled: true,
  }
}

export * as AshbyEdge from "./ashby-edge"
