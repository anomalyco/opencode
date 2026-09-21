export type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type UsageCoverage = "complete" | "partial" | "unavailable"

export type KnownUsage<Value> = {
  value: Value | undefined
  coverage: UsageCoverage
}

export type UsageRecord = {
  serverKey: string
  sessionID: string
  messageID?: string
  parentSessionID?: string
  inclusive?: boolean
  currency?: string
  cost?: number
  tokens?: TokenUsage
  complete?: boolean
}

export type UsageRejections = {
  server: number
  currency: number
  inclusive: number
}

export type UsageAggregate = {
  cost: KnownUsage<number>
  tokens: KnownUsage<number>
  contextPercent: number | undefined
  records: number
  duplicates: number
  rejected: UsageRejections
}

export const ACCOUNTING_CURRENCY = "USD"

export function tokenTotal(tokens: TokenUsage) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function sumKnownCost(values: (number | undefined)[]) {
  const known = values.filter((value): value is number => value !== undefined)
  if (!known.length) return { value: undefined, coverage: "unavailable" as const }
  return {
    value: known.reduce((total, value) => total + value, 0),
    coverage: known.length === values.length ? ("complete" as const) : ("partial" as const),
  }
}

export function sumKnownTokens(values: (TokenUsage | undefined)[]) {
  return sumKnownCost(values.map((value) => (value === undefined ? undefined : tokenTotal(value))))
}

export function contextPercent(used: number | undefined, denominator: number | undefined) {
  if (used === undefined || denominator === undefined) return undefined
  if (!Number.isFinite(used) || !Number.isFinite(denominator) || denominator <= 0) return undefined
  return Math.round((used / denominator) * 100)
}

export function sumUsageRecords(
  records: UsageRecord[],
  options: { serverKey?: string; currency?: string; contextLimit?: number; complete?: boolean } = {},
): UsageAggregate {
  const serverKey = options.serverKey ?? records[0]?.serverKey
  const currency = options.currency ?? ACCOUNTING_CURRENCY
  const rejected: UsageRejections = { server: 0, currency: 0, inclusive: 0 }
  const seen = new Set<string>()
  const accepted: UsageRecord[] = []
  let duplicates = 0

  for (const record of records) {
    if (serverKey !== undefined && record.serverKey !== serverKey) {
      rejected.server += 1
      continue
    }
    const identity = `${record.serverKey}\u0000${record.sessionID}\u0000${record.messageID ?? ""}`
    if (seen.has(identity)) {
      duplicates += 1
      continue
    }
    seen.add(identity)
    accepted.push(record)
  }

  const parents = new Map(
    accepted.flatMap((record) => (record.parentSessionID ? [[record.sessionID, record.parentSessionID] as const] : [])),
  )
  const summaries = new Set(accepted.filter(isSessionSummary).map((record) => record.sessionID))
  const inclusive = accepted.filter((record) => record.inclusive === true)
  const included = accepted.filter((record) => {
    const covered = isCoveredRecord(record, { summaries, inclusive, parents })
    if (covered) rejected.inclusive += 1
    return !covered
  })

  rejected.currency = included.filter((record) => isForeignCurrency(record, currency)).length
  const loaded = options.complete !== false && included.every((record) => record.complete !== false)
  const cost = aggregateCost(included, currency, loaded)
  const tokens = aggregateMetric(
    included,
    (record) => (record.tokens === undefined ? undefined : tokenTotal(record.tokens)),
    loaded,
  )
  return {
    cost,
    tokens,
    contextPercent: contextPercent(tokens.value, options.contextLimit),
    records: included.length,
    duplicates,
    rejected,
  }
}

function isForeignCurrency(record: UsageRecord, currency: string) {
  return record.currency !== undefined && record.currency !== currency
}

function aggregateCost(records: UsageRecord[], currency: string, loaded: boolean): KnownUsage<number> {
  const values = records.map((record) => (isForeignCurrency(record, currency) ? undefined : record.cost))
  const known = values.filter((value): value is number => value !== undefined)
  if (known.length === 0) return { value: undefined, coverage: "unavailable" }
  const excluded = records.some((record) => isForeignCurrency(record, currency) && record.cost !== undefined)
  return {
    value: known.reduce((total, value) => total + value, 0),
    coverage: known.length === values.length && loaded && !excluded ? "complete" : "partial",
  }
}

function isSessionSummary(record: UsageRecord) {
  return record.messageID === undefined
}

function isCoveredRecord(
  record: UsageRecord,
  input: { summaries: Set<string>; inclusive: UsageRecord[]; parents: Map<string, string> },
) {
  if (!isSessionSummary(record) && input.summaries.has(record.sessionID)) return true
  return input.inclusive.some(
    (summary) => summary !== record && isAncestor(summary.sessionID, record.sessionID, input.parents),
  )
}

function isAncestor(ancestorID: string, sessionID: string, parents: Map<string, string>) {
  const seen = new Set<string>()
  let current = sessionID
  while (!seen.has(current)) {
    seen.add(current)
    if (current === ancestorID) return true
    const next = parents.get(current)
    if (next === undefined) return false
    current = next
  }
  return false
}

function aggregateMetric(
  records: UsageRecord[],
  select: (record: UsageRecord) => number | undefined,
  loaded: boolean,
): KnownUsage<number> {
  const values = records.map(select)
  const known = values.filter((value): value is number => value !== undefined)
  if (known.length === 0) return { value: undefined, coverage: "unavailable" }
  return {
    value: known.reduce((total, value) => total + value, 0),
    coverage: known.length === values.length && loaded ? "complete" : "partial",
  }
}
