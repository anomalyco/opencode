import { Database, and, eq, sql } from "../src/drizzle/index.js"
import { AuthTable } from "../src/schema/auth.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import {
  BillingTable,
  PaymentTable,
  SubscriptionTable,
  BlackPlans,
  UsageTable,
  LiteTable,
} from "../src/schema/billing.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"
import { KeyTable } from "../src/schema/key.sql.js"
import { BlackData } from "../src/black.js"
import { centsToMicroCents } from "../src/util/price.js"
import { getWeekBounds } from "../src/util/date.js"
import { ModelTable } from "../src/schema/model.sql.js"

// get input from command line
const identifier = process.argv[2]
if (!identifier) {
  console.error("Usage: bun lookup-user.ts <email|workspaceID|apiKey>")
  process.exit(1)
}

// loop up by workspace ID
if (identifier.startsWith("wrk_")) {
  await printWorkspace(identifier)
}
// lookup by API key ID
else if (identifier.startsWith("key_")) {
  const key = await Database.use((tx) =>
    tx
      .select()
      .from(KeyTable)
      .where(eq(KeyTable.id, identifier))
      .then((rows) => rows[0]),
  )
  if (!key) {
    console.error("API key not found")
    process.exit(1)
  }
  await printWorkspace(key.workspaceID)
}
// lookup by API key value
else if (identifier.startsWith("sk-")) {
  const key = await Database.use((tx) =>
    tx
      .select()
      .from(KeyTable)
      .where(eq(KeyTable.key, identifier))
      .then((rows) => rows[0]),
  )
  if (!key) {
    console.error("API key not found")
    process.exit(1)
  }
  await printWorkspace(key.workspaceID)
}
// lookup by email
else {
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
        black: SubscriptionTable.timeCreated,
        lite: LiteTable.timeCreated,
      })
      .from(UserTable)
      .rightJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
      .leftJoin(SubscriptionTable, eq(SubscriptionTable.userID, UserTable.id))
      .leftJoin(LiteTable, eq(LiteTable.userID, UserTable.id))
      .where(eq(UserTable.accountID, accountID))
      .then((rows) =>
        rows.map((row) => ({
          userID: row.userID,
          workspaceID: row.workspaceID,
          workspaceName: row.workspaceName,
          role: row.role,
          black: formatDate(row.black),
          lite: formatDate(row.lite),
        })),
      ),
  )

  for (const user of users) {
    await printWorkspace(user.workspaceID)
  }
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
        subscription: BillingTable.subscription,
      })
      .from(UserTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, workspace.id))
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
        blackSubscriptionID: BillingTable.subscriptionID,
        blackSubscription: {
          plan: BillingTable.subscriptionPlan,
          booked: BillingTable.timeSubscriptionBooked,
          enrichment: BillingTable.subscription,
        },
        timeBlackSubscriptionSelected: BillingTable.timeSubscriptionSelected,
        liteSubscriptionID: BillingTable.liteSubscriptionID,
      })
      .from(BillingTable)
      .where(eq(BillingTable.workspaceID, workspace.id))
      .then(
        (rows) =>
          rows.map((row) => ({
            balance: `$${(row.balance / 100000000).toFixed(2)}`,
            reload: row.reload ? "yes" : "no",
            customerID: row.customerID,
            GO: row.liteSubscriptionID,
            Black: row.blackSubscriptionID
              ? [
                  `Black ${row.blackSubscription.enrichment!.plan}`,
                  row.blackSubscription.enrichment!.seats > 1
                    ? `X ${row.blackSubscription.enrichment!.seats} seats`
                    : "",
                  row.blackSubscription.enrichment!.coupon
                    ? `(coupon: ${row.blackSubscription.enrichment!.coupon})`
                    : "",
                  `(ref: ${row.blackSubscriptionID})`,
                ].join(" ")
              : row.blackSubscription.booked
                ? `Waitlist ${row.blackSubscription.plan} plan${row.timeBlackSubscriptionSelected ? " (selected)" : ""}`
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

  await printTable("28-Day Usage", (tx) =>
    tx
      .select({
        date: sql<string>`DATE(${UsageTable.timeCreated})`.as("date"),
        requests: sql<number>`COUNT(*)`.as("requests"),
        inputTokens: sql<number>`SUM(${UsageTable.inputTokens})`.as("input_tokens"),
        outputTokens: sql<number>`SUM(${UsageTable.outputTokens})`.as("output_tokens"),
        reasoningTokens: sql<number>`SUM(${UsageTable.reasoningTokens})`.as("reasoning_tokens"),
        cacheReadTokens: sql<number>`SUM(${UsageTable.cacheReadTokens})`.as("cache_read_tokens"),
        cacheWrite5mTokens: sql<number>`SUM(${UsageTable.cacheWrite5mTokens})`.as("cache_write_5m_tokens"),
        cacheWrite1hTokens: sql<number>`SUM(${UsageTable.cacheWrite1hTokens})`.as("cache_write_1h_tokens"),
        cost: sql<number>`SUM(${UsageTable.cost})`.as("cost"),
      })
      .from(UsageTable)
      .where(
        and(
          eq(UsageTable.workspaceID, workspace.id),
          sql`${UsageTable.timeCreated} >= DATE_SUB(NOW(), INTERVAL 28 DAY)`,
        ),
      )
      .groupBy(sql`DATE(${UsageTable.timeCreated})`)
      .orderBy(sql`DATE(${UsageTable.timeCreated}) DESC`)
      .then((rows) => {
        const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0)
        const mapped = rows.map((row) => ({
          ...row,
          cost: `$${(Number(row.cost) / 100000000).toFixed(2)}`,
        }))
        if (mapped.length > 0) {
          mapped.push({
            date: "TOTAL",
            requests: null as any,
            inputTokens: null as any,
            outputTokens: null as any,
            reasoningTokens: null as any,
            cacheReadTokens: null as any,
            cacheWrite5mTokens: null as any,
            cacheWrite1hTokens: null as any,
            cost: `$${(totalCost / 100000000).toFixed(2)}`,
          })
        }
        return mapped
      }),
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
  await printTable("Disabled Models", (tx) =>
    tx
      .select({
        model: ModelTable.model,
        timeCreated: ModelTable.timeCreated,
      })
      .from(ModelTable)
      .where(eq(ModelTable.workspaceID, workspace.id))
      .orderBy(sql`${ModelTable.timeCreated} DESC`)
      .then((rows) =>
        rows.map((row) => ({
          model: row.model,
          timeCreated: formatDate(row.timeCreated),
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
  subscription: {
    plan: (typeof BlackPlans)[number]
  } | null
  timeSubscriptionCreated: Date | null
  fixedUsage: number | null
  rollingUsage: number | null
  timeFixedUpdated: Date | null
  timeRollingUpdated: Date | null
}) {
  if (!row.timeSubscriptionCreated || !row.subscription) {
    return { weekly: null, rolling: null, rateLimited: null, retryIn: null }
  }

  const black = BlackData.getLimits({ plan: row.subscription.plan })
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
