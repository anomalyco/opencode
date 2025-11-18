import { Resource } from "@opencode-ai/console-resource"
import { Database } from "../src/drizzle/index.js"
import { UserTable } from "../src/schema/user.sql.js"
import { AccountTable } from "../src/schema/account.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"
import { BillingTable, PaymentTable, UsageTable } from "../src/schema/billing.sql.js"
import { KeyTable } from "../src/schema/key.sql.js"

if (Resource.App.stage !== "frank") throw new Error("This script is only for frank")

for (const table of [AccountTable, BillingTable, KeyTable, PaymentTable, UsageTable, UserTable, WorkspaceTable]) {
  await Database.use((tx) => tx.delete(table))
}
