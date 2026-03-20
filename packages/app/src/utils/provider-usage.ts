type Limits = {
  weekly: number
  session: number
}

type Usage = {
  week: string
  limits: Record<string, Limits>
  weekly: Record<string, number>
  session: Record<string, Record<string, number>>
}

export type ProviderUsage = {
  id: string
  weekly: { used: number; limit: number; remaining: number | null }
  session: { used: number; limit: number; remaining: number | null }
}

const defaults: Usage = {
  week: "",
  limits: {},
  weekly: {},
  session: {},
}

const week = (date = new Date()) => {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const year = value.getUTCFullYear()
  const start = new Date(Date.UTC(year, 0, 1))
  const number = Math.ceil(((value.getTime() - start.getTime()) / 86_400_000 + 1) / 7)
  return `${year}-W${`${number}`.padStart(2, "0")}`
}

const key = (dir: string) => `opencode:provider-usage:${dir}`

const read = (dir: string): Usage => {
  if (typeof window === "undefined") return { ...defaults, week: week() }
  const raw = window.localStorage.getItem(key(dir))
  if (!raw) return { ...defaults, week: week() }
  try {
    const out = JSON.parse(raw) as Usage
    if (out.week === week()) return out
    return { ...out, week: week(), weekly: {} }
  } catch {
    return { ...defaults, week: week() }
  }
}

const write = (dir: string, value: Usage) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key(dir), JSON.stringify(value))
}

const clean = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export const setProviderLimit = (dir: string, id: string, patch: Partial<Limits>) => {
  const data = read(dir)
  const limits = data.limits[id] ?? { weekly: 0, session: 0 }
  data.limits[id] = {
    weekly: patch.weekly === undefined ? limits.weekly : clean(patch.weekly),
    session: patch.session === undefined ? limits.session : clean(patch.session),
  }
  write(dir, data)
}

export const trackProviderUsage = (dir: string, id: string, sessionID?: string) => {
  const data = read(dir)
  data.weekly[id] = clean(data.weekly[id] ?? 0) + 1
  if (sessionID) {
    const row = data.session[sessionID] ?? {}
    row[id] = clean(row[id] ?? 0) + 1
    data.session[sessionID] = row
  }
  write(dir, data)
}

export const getProviderUsage = (dir: string, ids: string[], sessionID?: string): ProviderUsage[] => {
  const data = read(dir)
  return ids.map((id) => {
    const limits = data.limits[id] ?? { weekly: 0, session: 0 }
    const weeklyUsed = clean(data.weekly[id] ?? 0)
    const sessionUsed = sessionID ? clean(data.session[sessionID]?.[id] ?? 0) : 0
    return {
      id,
      weekly: {
        used: weeklyUsed,
        limit: limits.weekly,
        remaining: limits.weekly > 0 ? Math.max(0, limits.weekly - weeklyUsed) : null,
      },
      session: {
        used: sessionUsed,
        limit: limits.session,
        remaining: limits.session > 0 ? Math.max(0, limits.session - sessionUsed) : null,
      },
    }
  })
}
