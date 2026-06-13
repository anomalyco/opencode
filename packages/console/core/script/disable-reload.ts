import { Database, eq } from "../src/drizzle/index.js"
import { BillingTable } from "../src/schema/billing.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"

const workspaceID = process.argv[2]

if (!workspaceID) {
  console.error("Usage: bun disable-reload.ts <workspaceID>")
  process.exit(1)
}

const billing = await Database.use((tx) =>
  tx
    .select({ reload: BillingTable.reload })
    .from(BillingTable)
    .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, BillingTable.workspaceID))
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0]),
)
if (!billing) {
  console.error("Error: Workspace or billing record not found")
  process.exit(1)
}

if (!billing.reload) {
  console.log(`Reload is already disabled for workspace ${workspaceID}`)
  process.exit(0)
}

await Database.use((tx) =>
  tx.update(BillingTable).set({ reload: false }).where(eq(BillingTable.workspaceID, workspaceID)),
)

console.log(`Disabled reload for workspace ${workspaceID}`)
