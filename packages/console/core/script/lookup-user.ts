import { Database, and, eq, sql } from "../src/drizzle/index.js"
import { AuthTable } from "../src/schema/auth.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { BillingTable, PaymentTable, SubscriptionTable, UsageTable } from "../src/schema/billing.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"
import { BlackData } from "../src/black.js"
import { centsToMicroCents } from "../src/util/price.js"
import { getWeekBounds } from "../src/util/date.js"

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
        subscribed: SubscriptionTable.timeCreated,
      })
      .from(UserTable)
      .rightJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
      .leftJoin(SubscriptionTable, eq(SubscriptionTable.userID, UserTable.id))
      .where(eq(UserTable.accountID, accountID))
      .then((rows) =>
        rows.map((row) => ({
          userID: row.userID,
          workspaceID: row.workspaceID,
          workspaceName: row.workspaceName,
          role: row.role,
          subscribed: formatDate(row.subscribed),
        })),
      ),
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

  await printTable("Users", (tx) =>
    tx
      .select({
        authEmail: AuthTable.subject,
        inviteEmail: UserTable.email,
        role: UserTable.role,
        timeSeen: UserTable.timeSeen,
        monthlyLimit: UserTable.monthlyLimit,
        monthlyUsage: UserTable.monthlyUsage,
        timeDeleted: UserTable.timeDeleted,
        fixedUsage: SubscriptionTable.fixedUsage,
        rollingUsage: SubscriptionTable.rollingUsage,
        timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
        timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
        timeSubscriptionCreated: SubscriptionTable.timeCreated,
      })
      .from(UserTable)
      .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
      .leftJoin(SubscriptionTable, eq(SubscriptionTable.userID, UserTable.id))
      .where(eq(UserTable.workspaceID, workspace.id))
      .then((rows) =>
        rows.map((row) => {
          const subStatus = getSubscriptionStatus(row)
          return {
            email: (row.timeDeleted ? "❌ " : "") + (row.authEmail ?? row.inviteEmail),
            role: row.role,
            timeSeen: formatDate(row.timeSeen),
            monthly: formatMonthlyUsage(row.monthlyUsage, row.monthlyLimit),
            subscribed: formatDate(row.timeSubscriptionCreated),
            subWeekly: subStatus.weekly,
            subRolling: subStatus.rolling,
            rateLimited: subStatus.rateLimited,
            retryIn: subStatus.retryIn,
          }
        }),
      ),
  )

  await printTable("Billing", (tx) =>
    tx
      .select({
        balance: BillingTable.balance,
        customerID: BillingTable.customerID,
        reload: BillingTable.reload,
        subscription: {
          id: BillingTable.subscriptionID,
          couponID: BillingTable.subscriptionCouponID,
          plan: BillingTable.subscriptionPlan,
          booked: BillingTable.timeSubscriptionBooked,
        },
      })
      .from(BillingTable)
      .where(eq(BillingTable.workspaceID, workspace.id))
      .then(
        (rows) =>
          rows.map((row) => ({
            ...row,
            balance: `$${(row.balance / 100000000).toFixed(2)}`,
            subscription: row.subscription.id
              ? `Subscribed ${row.subscription.couponID ? `(coupon: ${row.subscription.couponID}) ` : ""}`
              : row.subscription.booked
                ? `Waitlist ${row.subscription.plan} plan`
                : undefined,
          }))[0],
      ),
  )

  await printTable("Payments", (tx) =>
    tx
      .select({
        amount: PaymentTable.amount,
        paymentID: PaymentTable.paymentID,
        invoiceID: PaymentTable.invoiceID,
        customerID: PaymentTable.customerID,
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

  /*
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
        */
}

function formatMicroCents(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  return `$${(value / 100000000).toFixed(2)}`
}

function formatDate(value: Date | null | undefined) {
  if (!value) return null
  return value.toISOString().split("T")[0]
}

function formatMonthlyUsage(usage: number | null | undefined, limit: number | null | undefined) {
  const usageText = formatMicroCents(usage) ?? "$0.00"
  if (limit === null || limit === undefined) return `${usageText} / no limit`
  return `${usageText} / $${limit.toFixed(2)}`
}

function formatRetryTime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""}`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  if (hours >= 1) return `${hours}hr ${minutes}min`
  return `${minutes}min`
}

function getSubscriptionStatus(row: {
  timeSubscriptionCreated: Date | null
  fixedUsage: number | null
  rollingUsage: number | null
  timeFixedUpdated: Date | null
  timeRollingUpdated: Date | null
}) {
  if (!row.timeSubscriptionCreated) {
    return { weekly: null, rolling: null, rateLimited: null, retryIn: null }
  }

  const black = BlackData.get()
  const now = new Date()
  const week = getWeekBounds(now)

  const fixedLimit = black.fixedLimit ? centsToMicroCents(black.fixedLimit * 100) : null
  const rollingLimit = black.rollingLimit ? centsToMicroCents(black.rollingLimit * 100) : null
  const rollingWindowMs = (black.rollingWindow ?? 5) * 3600 * 1000

  // Calculate current weekly usage (reset if outside current week)
  const currentWeekly =
    row.fixedUsage && row.timeFixedUpdated && row.timeFixedUpdated >= week.start ? row.fixedUsage : 0

  // Calculate current rolling usage
  const windowStart = new Date(now.getTime() - rollingWindowMs)
  const currentRolling =
    row.rollingUsage && row.timeRollingUpdated && row.timeRollingUpdated >= windowStart ? row.rollingUsage : 0

  // Check rate limiting
  const isWeeklyLimited = fixedLimit !== null && currentWeekly >= fixedLimit
  const isRollingLimited = rollingLimit !== null && currentRolling >= rollingLimit

  let retryIn: string | null = null
  if (isWeeklyLimited) {
    const retryAfter = Math.ceil((week.end.getTime() - now.getTime()) / 1000)
    retryIn = formatRetryTime(retryAfter)
  } else if (isRollingLimited && row.timeRollingUpdated) {
    const retryAfter = Math.ceil((row.timeRollingUpdated.getTime() + rollingWindowMs - now.getTime()) / 1000)
    retryIn = formatRetryTime(retryAfter)
  }

  return {
    weekly: fixedLimit !== null ? `${formatMicroCents(currentWeekly)} / $${black.fixedLimit}` : null,
    rolling: rollingLimit !== null ? `${formatMicroCents(currentRolling)} / $${black.rollingLimit}` : null,
    rateLimited: isWeeklyLimited || isRollingLimited ? "yes" : "no",
    retryIn,
  }
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
