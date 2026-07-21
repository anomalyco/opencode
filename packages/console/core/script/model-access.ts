import { parseArgs } from "node:util"
import { Database, eq } from "../src/drizzle/index.js"
import { ModelAccess } from "../src/model-access.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    workspace: { type: "string", short: "w" },
    provider: { type: "string", short: "p" },
    unblock: { type: "boolean", default: false },
  },
})

if (!args.values.workspace || !args.values.provider) {
  console.error("Usage: model-access.ts --workspace <workspaceID> --provider <anthropic|openai> [--unblock]")
  process.exit(1)
}

const provider = ModelAccess.parseProvider(args.values.provider)
const workspace = await Database.use((tx) =>
  tx
    .select({ block: WorkspaceTable.blocked_model_providers })
    .from(WorkspaceTable)
    .where(eq(WorkspaceTable.id, args.values.workspace!))
    .then((rows) => rows[0]),
)

if (!workspace) {
  console.error(`Workspace ${args.values.workspace} not found`)
  process.exit(1)
}

const current = workspace.block ?? []
const block = args.values.unblock
  ? current.filter((item) => item !== provider)
  : Array.from(new Set([...current, provider]))

await Database.use((tx) =>
  tx
    .update(WorkspaceTable)
    .set({ blocked_model_providers: block })
    .where(eq(WorkspaceTable.id, args.values.workspace!)),
)

console.log(`${args.values.unblock ? "Unblocked" : "Blocked"} ${provider} models for ${args.values.workspace}`)
