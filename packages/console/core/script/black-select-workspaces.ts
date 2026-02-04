import { Database, eq, and, sql, inArray, isNull, count } from "../src/drizzle/index.js"
import { BillingTable, SubscriptionPlan } from "../src/schema/billing.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { AuthTable } from "../src/schema/auth.sql.js"

const plan = process.argv[2] as (typeof SubscriptionPlan)[number]
if (!SubscriptionPlan.includes(plan)) {
  console.error("Usage: bun foo.ts <count>")
  process.exit(1)
}

const workspaces = await Database.use((tx) =>
  tx
    .select({ workspaceID: BillingTable.workspaceID })
    .from(BillingTable)
    .where(and(eq(BillingTable.subscriptionPlan, plan), isNull(BillingTable.timeSubscriptionSelected)))
    .orderBy(sql`RAND()`)
    .limit(100),
)

console.log(`Found ${workspaces.length} workspaces on Black ${plan} waitlist`)

console.log("== Workspace IDs ==")
const ids = workspaces.map((w) => w.workspaceID)
for (const id of ids) {
  console.log(id)
}

console.log("\n== User Emails ==")
const emails = await Database.use((tx) =>
  tx
    .select({ email: AuthTable.subject })
    .from(UserTable)
    .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
    .where(inArray(UserTable.workspaceID, ids)),
)

const unique = new Set(emails.map((row) => row.email))
for (const email of unique) {
  console.log(email)
}
