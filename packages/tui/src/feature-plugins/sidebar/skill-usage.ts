export type SkillUsage = Record<string, { count: number; lastUsed: number }>

export function sanitizeSkillUsage(value: unknown, now: number): SkillUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const count = Reflect.get(item, "count")
      const lastUsed = Reflect.get(item, "lastUsed")
      if (!Number.isSafeInteger(count) || count < 0) return []
      if (!Number.isFinite(lastUsed) || lastUsed < 0) return []
      return [[name, { count, lastUsed: Math.min(lastUsed, now) }]]
    }),
  )
}

export function incrementSkillUsage(value: SkillUsage, name: string, now: number): SkillUsage {
  const current = value[name]
  return {
    ...value,
    [name]: {
      count: (current?.count ?? 0) + 1,
      lastUsed: now,
    },
  }
}

export function rankSkills(names: readonly string[], value: SkillUsage, now: number, limit = 10) {
  return [...new Set(names)]
    .map((name) => {
      const usage = value[name]
      const age = usage ? Math.max(0, now - usage.lastUsed) / 86_400_000 : 0
      return {
        name,
        count: usage?.count ?? 0,
        lastUsed: usage?.lastUsed ?? 0,
        score: usage ? usage.count / (1 + age) : 0,
      }
    })
    .sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed || a.name.localeCompare(b.name))
    .slice(0, limit)
}
