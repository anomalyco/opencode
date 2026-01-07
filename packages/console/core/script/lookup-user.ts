import { Database, eq, sql, inArray } from "../src/drizzle/index.js"
import { AuthTable } from "../src/schema/auth.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { BillingTable, PaymentTable, UsageTable } from "../src/schema/billing.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"

// get input from command line
const identifier = process.argv[2]
if (!identifier) {
  console.error("Usage: bun lookup-user.ts <email|workspaceID>")
  process.exit(1)
}

if (identifier.startsWith("wrk_")) {
  await printWorkspace(identifier)
} else {
  const authData = await Database.use(async (tx) =>
    tx.select().from(AuthTable).where(eq(AuthTable.subject, identifier)),
  )
  if (authData.length === 0) {
    console.error("Email not found")
    process.exit(1)
  }
  if (authData.length > 1) console.warn("Multiple users found for email", identifier)

  // Get all auth records for email
  const accountID = authData[0].accountID
  await printTable("Auth", (tx) => tx.select().from(AuthTable).where(eq(AuthTable.accountID, accountID)))

  // Get all workspaces for this account
  const users = await printTable("Workspaces", (tx) =>
    tx
      .select({
        userID: UserTable.id,
        workspaceID: UserTable.workspaceID,
        workspaceName: WorkspaceTable.name,
        role: UserTable.role,
      })
      .from(UserTable)
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
      .where(eq(UserTable.accountID, accountID)),
  )

  // Get all payments for these workspaces
  await Promise.all(users.map((u: { workspaceID: string }) => printWorkspace(u.workspaceID)))
}

async function printWorkspace(workspaceID: string) {
  const workspace = await Database.use((tx) =>
    tx
      .select()
      .from(WorkspaceTable)
      .where(eq(WorkspaceTable.id, workspaceID))
      .then((rows) => rows[0]),
  )

  printHeader(`Workspace "${workspace.name}" (${workspace.id})`)

  await printTable("Billing", (tx) =>
    tx
      .select({
        balance: BillingTable.balance,
        customerID: BillingTable.customerID,
      })
      .from(BillingTable)
      .where(eq(BillingTable.workspaceID, workspace.id))
      .then(
        (rows) =>
          rows.map((row) => ({
            ...row,
            balance: `$${(row.balance / 100000000).toFixed(2)}`,
          }))[0],
      ),
  )

  await printTable("Payments", (tx) =>
    tx
      .select({
        amount: PaymentTable.amount,
        paymentID: PaymentTable.paymentID,
        invoiceID: PaymentTable.invoiceID,
        timeCreated: PaymentTable.timeCreated,
        timeRefunded: PaymentTable.timeRefunded,
      })
      .from(PaymentTable)
      .where(eq(PaymentTable.workspaceID, workspace.id))
      .orderBy(sql`${PaymentTable.timeCreated} DESC`)
      .limit(100)
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          amount: `$${(row.amount / 100000000).toFixed(2)}`,
          paymentID: row.paymentID
            ? `https://dashboard.stripe.com/acct_1RszBH2StuRr0lbX/payments/${row.paymentID}`
            : null,
        })),
      ),
  )

  await printTable("Usage", (tx) =>
    tx
      .select({
        model: UsageTable.model,
        provider: UsageTable.provider,
        inputTokens: UsageTable.inputTokens,
        outputTokens: UsageTable.outputTokens,
        reasoningTokens: UsageTable.reasoningTokens,
        cacheReadTokens: UsageTable.cacheReadTokens,
        cacheWrite5mTokens: UsageTable.cacheWrite5mTokens,
        cacheWrite1hTokens: UsageTable.cacheWrite1hTokens,
        cost: UsageTable.cost,
        timeCreated: UsageTable.timeCreated,
      })
      .from(UsageTable)
      .where(eq(UsageTable.workspaceID, workspace.id))
      .orderBy(sql`${UsageTable.timeCreated} DESC`)
      .limit(10)
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          cost: `$${(row.cost / 100000000).toFixed(2)}`,
        })),
      ),
  )
}

function printHeader(title: string) {
  console.log()
  console.log("─".repeat(title.length))
  console.log(`${title}`)
  console.log("─".repeat(title.length))
}

function printTable(title: string, callback: (tx: Database.TxOrDb) => Promise<any>): Promise<any> {
  return Database.use(async (tx) => {
    const data = await callback(tx)
    console.log(`\n== ${title} ==`)
    if (data.length === 0) {
      console.log("(no data)")
    } else {
      console.table(data)
    }
    return data
  })
}
