import { createHash } from "node:crypto"
import { Integration } from "@opencode/schema/integration"

/**
 * The integration a remote MCP server owns its OAuth credential under. Identity is keyed on name + url, not
 * url alone: two configs for the same url under different names are distinct logical servers that may hold
 * different accounts, so they must not share a credential row. The legacy credential import re-derives the
 * same id from a V1 entry, so both sides must keep going through this function.
 */
export const mcpIntegrationID = (name: string, url: string) =>
  Integration.ID.make("mcp_" + createHash("sha1").update(name + "\u0000" + url).digest("hex").slice(0, 16))
