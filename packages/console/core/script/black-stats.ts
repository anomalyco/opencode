import { Database, and, eq, inArray, isNotNull, sql } from "../src/drizzle/index.js"
import { BillingTable, BlackPlans, SubscriptionTable, UsageTable } from "../src/schema/billing.sql.js"

if (process.argv.length < 3) {
  console.error("Usage: bun black-stats.ts <plan>")
  process.exit(1)
}
const plan = process.argv[2] as (typeof BlackPlans)[number]
if (!BlackPlans.includes(plan)) {
  console.error("Usage: bun black-stats.ts <plan>")
  process.exit(1)
}
const cutoff = new Date(Date.UTC(2026, 1, 0, 23, 59, 59, 999))

// get workspaces
const workspaces = await Database.use((tx) =>
  tx
    .select({ workspaceID: BillingTable.workspaceID })
    .from(BillingTable)
    .where(
      and(isNotNull(BillingTable.subscriptionID), sql`JSON_UNQUOTE(JSON_EXTRACT(subscription, '$.plan')) = ${plan}`),
    ),
)
if (workspaces.length === 0) throw new Error(`No active Black ${plan} subscriptions found`)

const week = sql<number>`YEARWEEK(${UsageTable.timeCreated}, 3)`
const workspaceIDs = workspaces.map((row) => row.workspaceID)
// Get subscription spend
const spend = await Database.use((tx) =>
  tx
    .select({
      workspaceID: UsageTable.workspaceID,
      week,
      amount: sql<number>`COALESCE(SUM(${UsageTable.cost}), 0)`,
    })
    .from(UsageTable)
    .where(
      and(inArray(UsageTable.workspaceID, workspaceIDs), sql`JSON_UNQUOTE(JSON_EXTRACT(enrichment, '$.plan')) = 'sub'`),
    )
    .groupBy(UsageTable.workspaceID, week),
)

// Get pay per use spend
const ppu = await Database.use((tx) =>
  tx
    .select({
      workspaceID: UsageTable.workspaceID,
      week,
      amount: sql<number>`COALESCE(SUM(${UsageTable.cost}), 0)`,
    })
    .from(UsageTable)
    .where(
      and(
        inArray(UsageTable.workspaceID, workspaceIDs),
        sql`(${UsageTable.enrichment} IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(enrichment, '$.plan')) != 'sub')`,
      ),
    )
    .groupBy(UsageTable.workspaceID, week),
)

const models = await Database.use((tx) =>
  tx
    .select({
      workspaceID: UsageTable.workspaceID,
      model: UsageTable.model,
      amount: sql<number>`COALESCE(SUM(${UsageTable.cost}), 0)`,
    })
    .from(UsageTable)
    .where(
      and(inArray(UsageTable.workspaceID, workspaceIDs), sql`JSON_UNQUOTE(JSON_EXTRACT(enrichment, '$.plan')) = 'sub'`),
    )
    .groupBy(UsageTable.workspaceID, UsageTable.model),
)

const tokens = await Database.use((tx) =>
  tx
    .select({
      workspaceID: UsageTable.workspaceID,
      week,
      input: sql<number>`COALESCE(SUM(${UsageTable.inputTokens}), 0)`,
      cacheRead: sql<number>`COALESCE(SUM(${UsageTable.cacheReadTokens}), 0)`,
      output: sql<number>`COALESCE(SUM(${UsageTable.outputTokens}), 0) + COALESCE(SUM(${UsageTable.reasoningTokens}), 0)`,
    })
    .from(UsageTable)
    .where(
      and(inArray(UsageTable.workspaceID, workspaceIDs), sql`JSON_UNQUOTE(JSON_EXTRACT(enrichment, '$.plan')) = 'sub'`),
    )
    .groupBy(UsageTable.workspaceID, week),
)

const allWeeks = [...spend, ...ppu].map((row) => row.week)
const weeks = [...new Set(allWeeks)].sort((a, b) => a - b)
const spendMap = new Map<string, Map<number, number>>()
const totals = new Map<string, number>()
const ppuMap = new Map<string, Map<number, number>>()
const ppuTotals = new Map<string, number>()
const modelMap = new Map<string, { model: string; amount: number }[]>()
const tokenMap = new Map<string, Map<number, { input: number; cacheRead: number; output: number }>>()

for (const row of spend) {
  const workspace = spendMap.get(row.workspaceID) ?? new Map<number, number>()
  const total = totals.get(row.workspaceID) ?? 0
  const amount = toNumber(row.amount)
  workspace.set(row.week, amount)
  totals.set(row.workspaceID, total + amount)
  spendMap.set(row.workspaceID, workspace)
}

for (const row of ppu) {
  const workspace = ppuMap.get(row.workspaceID) ?? new Map<number, number>()
  const total = ppuTotals.get(row.workspaceID) ?? 0
  const amount = toNumber(row.amount)
  workspace.set(row.week, amount)
  ppuTotals.set(row.workspaceID, total + amount)
  ppuMap.set(row.workspaceID, workspace)
}

for (const row of models) {
  const current = modelMap.get(row.workspaceID) ?? []
  current.push({ model: row.model, amount: toNumber(row.amount) })
  modelMap.set(row.workspaceID, current)
}

for (const row of tokens) {
  const workspace = tokenMap.get(row.workspaceID) ?? new Map()
  workspace.set(row.week, {
    input: toNumber(row.input),
    cacheRead: toNumber(row.cacheRead),
    output: toNumber(row.output),
  })
  tokenMap.set(row.workspaceID, workspace)
}

const users = await Database.use((tx) =>
  tx
    .select({
      workspaceID: SubscriptionTable.workspaceID,
      subscribed: SubscriptionTable.timeCreated,
      subscription: BillingTable.subscription,
    })
    .from(SubscriptionTable)
    .innerJoin(BillingTable, eq(SubscriptionTable.workspaceID, BillingTable.workspaceID))
    .where(
      and(inArray(SubscriptionTable.workspaceID, workspaceIDs), sql`${SubscriptionTable.timeCreated} <= ${cutoff}`),
    ),
)

const counts = new Map<string, number>()
for (const user of users) {
  const current = counts.get(user.workspaceID) ?? 0
  counts.set(user.workspaceID, current + 1)
}

const rows = users
  .map((user) => {
    const workspace = spendMap.get(user.workspaceID) ?? new Map<number, number>()
    const ppuWorkspace = ppuMap.get(user.workspaceID) ?? new Map<number, number>()
    const count = counts.get(user.workspaceID) ?? 1
    const amount = (totals.get(user.workspaceID) ?? 0) / count
    const ppuAmount = (ppuTotals.get(user.workspaceID) ?? 0) / count
    const monthStart = user.subscribed ? startOfMonth(user.subscribed) : null
    const modelRows = (modelMap.get(user.workspaceID) ?? []).sort((a, b) => b.amount - a.amount).slice(0, 3)
    const modelTotal = totals.get(user.workspaceID) ?? 0
    const modelCells = modelRows.map((row) => ({
      model: row.model,
      percent: modelTotal > 0 ? `${((row.amount / modelTotal) * 100).toFixed(1)}%` : "0.0%",
    }))
    const modelData = [0, 1, 2].map((index) => modelCells[index] ?? { model: "-", percent: "-" })
    const weekly = Object.fromEntries(
      weeks.map((item) => {
        const value = (workspace.get(item) ?? 0) / count
        const beforeMonth = monthStart ? isoWeekStart(item) < monthStart : false
        return [formatWeek(item), beforeMonth ? "-" : formatMicroCents(value)]
      }),
    )
    const ppuWeekly = Object.fromEntries(
      weeks.map((item) => {
        const value = (ppuWorkspace.get(item) ?? 0) / count
        const beforeMonth = monthStart ? isoWeekStart(item) < monthStart : false
        return [formatWeek(item), beforeMonth ? "-" : formatMicroCents(value)]
      }),
    )
    const tokenWorkspace = tokenMap.get(user.workspaceID) ?? new Map()
    const weeklyTokens = Object.fromEntries(
      weeks.map((item) => {
        const t = tokenWorkspace.get(item) ?? { input: 0, cacheRead: 0, output: 0 }
        const beforeMonth = monthStart ? isoWeekStart(item) < monthStart : false
        return [
          formatWeek(item),
          beforeMonth
            ? { input: "-", cacheRead: "-", output: "-" }
            : {
                input: Math.round(t.input / count),
                cacheRead: Math.round(t.cacheRead / count),
                output: Math.round(t.output / count),
              },
        ]
      }),
    )
    return {
      workspaceID: user.workspaceID,
      useBalance: user.subscription?.useBalance ?? false,
      subscribed: formatDate(user.subscribed),
      subscribedAt: user.subscribed?.getTime() ?? 0,
      amount,
      ppuAmount,
      models: modelData,
      weekly,
      ppuWeekly,
      weeklyTokens,
    }
  })
  .sort((a, b) => a.subscribedAt - b.subscribedAt)

console.log(`Black ${plan} subscribers: ${rows.length}`)
const header = [
  "workspaceID",
  "subscribed",
  "useCredit",
  "subTotal",
  "ppuTotal",
  "model1",
  "model1%",
  "model2",
  "model2%",
  "model3",
  "model3%",
  ...weeks.flatMap((item) => [
    formatWeek(item) + " sub",
    formatWeek(item) + " ppu",
    formatWeek(item) + " input",
    formatWeek(item) + " cache",
    formatWeek(item) + " output",
  ]),
]
const lines = [header.map(csvCell).join(",")]
for (const row of rows) {
  const model1 = row.models[0]
  const model2 = row.models[1]
  const model3 = row.models[2]
  const cells = [
    row.workspaceID,
    row.subscribed ?? "",
    row.useBalance ? "yes" : "no",
    formatMicroCents(row.amount),
    formatMicroCents(row.ppuAmount),
    model1.model,
    model1.percent,
    model2.model,
    model2.percent,
    model3.model,
    model3.percent,
    ...weeks.flatMap((item) => {
      const t = row.weeklyTokens[formatWeek(item)] ?? { input: "-", cacheRead: "-", output: "-" }
      return [
        row.weekly[formatWeek(item)] ?? "",
        row.ppuWeekly[formatWeek(item)] ?? "",
        String(t.input),
        String(t.cacheRead),
        String(t.output),
      ]
    }),
  ]
  lines.push(cells.map(csvCell).join(","))
}
const output = `${lines.join("\n")}\n`
const file = Bun.file(`black-stats-${plan}.csv`)
await file.write(output)
console.log(`Wrote ${lines.length - 1} rows to ${file.name}`)
const total = rows.reduce((sum, row) => sum + row.amount, 0)
const average = rows.length === 0 ? 0 : total / rows.length
console.log(`Average spending per user: ${formatMicroCents(average)}`)

function formatMicroCents(value: number) {
  return `$${(value / 100000000).toFixed(2)}`
}

function formatDate(value: Date | null | undefined) {
  if (!value) return null
  return value.toISOString().split("T")[0]
}

function formatWeek(value: number) {
  return formatDate(isoWeekStart(value)) ?? ""
}

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
}

function isoWeekStart(value: number) {
  const year = Math.floor(value / 100)
  const weekNumber = value % 100
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const day = jan4.getUTCDay() || 7
  const weekStart = new Date(Date.UTC(year, 0, 4 - (day - 1)))
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekNumber - 1) * 7)
  return weekStart
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") return Number(value)
  return 0
}

function csvCell(value: string | number) {
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}
