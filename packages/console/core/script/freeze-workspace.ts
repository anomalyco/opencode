import { Billing } from "../src/billing.js"
import { Database, eq } from "../src/drizzle/index.js"
import { BillingTable } from "../src/schema/billing.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"
import { microCentsToCents } from "../src/util/price.js"

// get input from command line
const workspaceID = process.argv[2]

if (!workspaceID) {
  console.error("Usage: bun freeze-workspace.ts <workspaceID>")
  process.exit(1)
}

// check workspace exists
const workspace = await Database.use((tx) =>
  tx
    .select()
    .from(WorkspaceTable)
    .where(eq(WorkspaceTable.id, workspaceID))
    .then((rows) => rows[0]),
)
if (!workspace) {
  console.error("Error: Workspace not found")
  process.exit(1)
}

const billing = await Database.use((tx) =>
  tx
    .select()
    .from(BillingTable)
    .where(eq(BillingTable.workspaceID, workspaceID))
    .then((rows) => rows[0]),
)

const amountInDollars = microCentsToCents(billing.balance) / 100
await Billing.grantCredit(workspaceID, 0 - amountInDollars)

console.log(`Removed payment of $${amountInDollars.toFixed(2)} from workspace ${workspaceID}`)
