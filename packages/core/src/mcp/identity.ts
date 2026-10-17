export * as McpIdentity from "./identity.js"

import { createHash } from "node:crypto"
import { Integration } from "@opencode/schema/integration"

// Key identity on name + url, not url alone: two configs for the same url under different names are
// distinct logical servers that may hold different accounts, so they must not share a credential row.
// The V1 mcp-auth.json import derives the same id, so changing it orphans stored credentials.
export function integrationID(name: string, url: string) {
  return Integration.ID.make("mcp_" + createHash("sha1").update(name + "\u0000" + url).digest("hex").slice(0, 16))
}
