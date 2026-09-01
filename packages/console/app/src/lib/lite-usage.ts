export type LiteUsageBreakdownSource = {
  model: string
  name: string
  cost: number
  quotaCost: number
  multiplier?: number
  estimated: boolean
}

export type LiteUsageBreakdownItem = {
  model: string
  name: string
  cost?: number
  multiplier?: number
  quotaCost: number
  contributionPercent: number
  estimated: boolean
}

export function buildLiteUsageBreakdown(input: { usage: number; limit: number; sources: LiteUsageBreakdownSource[] }) {
  const rows: LiteUsageBreakdownItem[] = input.sources
    .filter((item) => item.cost !== 0 || item.quotaCost !== 0)
    .sort((a, b) => b.quotaCost - a.quotaCost)
    .map((item) => ({
      ...item,
      contributionPercent: 0,
    }))

  const usagePercent = getUsagePercent(input.usage, input.limit)
  const target = Math.max(0, Math.round(usagePercent * 10))
  const totalQuota = rows.reduce((total, item) => total + Math.max(0, item.quotaCost), 0)
  const units = rows.map((item) => {
    const exact = totalQuota === 0 ? 0 : (Math.max(0, item.quotaCost) / totalQuota) * target
    const value = Math.floor(exact)
    return { item, exact, value }
  })
  const remaining = target - units.reduce((total, item) => total + item.value, 0)
  const ranked = units.toSorted((a, b) => b.exact - b.value - (a.exact - a.value))
  Array.from({ length: ranked.length === 0 ? 0 : remaining }).forEach((_, index) => {
    ranked[index % ranked.length].value += 1
  })
  units.forEach((unit) => (unit.item.contributionPercent = unit.value / 10))

  return {
    usage: input.usage,
    limit: input.limit,
    usagePercent,
    rows,
  }
}

export function getModelQuotaLimit(limit: number, multiplier?: number) {
  if (multiplier === undefined || multiplier <= 0) return
  return limit / multiplier
}

export function getUsagePercent(amount: number, limit: number) {
  if (limit === 0) return 0
  return Math.round((amount / limit) * 1000) / 10
}
