type UsageControl = {
  enabled: boolean
  dailyLimit: number
}

type UsageCounter = {
  day: string
  used: number
}

export type UsageSnapshot = UsageControl &
  UsageCounter & {
    remaining: number
    blocked: boolean
  }

const defaults: UsageControl = {
  enabled: false,
  dailyLimit: 20,
}

const dayStamp = (date = new Date()) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

const storeKey = (dir: string, name: string) => `opencode:${name}:${dir}`

const read = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback
  const value = window.localStorage.getItem(key)
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const write = (key: string, value: unknown) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(value))
}

const clampLimit = (value: number) => Math.max(1, Math.min(10_000, Math.floor(value)))

const loadControl = (dir: string): UsageControl => {
  const value = read<Partial<UsageControl>>(storeKey(dir, "usage-control"), defaults)
  return {
    enabled: value.enabled === true,
    dailyLimit: clampLimit(value.dailyLimit ?? defaults.dailyLimit),
  }
}

const loadCounter = (dir: string): UsageCounter => {
  const today = dayStamp()
  const value = read<Partial<UsageCounter>>(storeKey(dir, "usage-counter"), {
    day: today,
    used: 0,
  })
  if (value.day !== today) return { day: today, used: 0 }
  return { day: today, used: Math.max(0, Math.floor(value.used ?? 0)) }
}

const snapshot = (control: UsageControl, counter: UsageCounter): UsageSnapshot => {
  const used = control.enabled ? counter.used : 0
  const remaining = control.enabled ? Math.max(0, control.dailyLimit - used) : control.dailyLimit
  return {
    ...control,
    ...counter,
    used,
    remaining,
    blocked: control.enabled && used >= control.dailyLimit,
  }
}

export const getFreeUsageSnapshot = (dir: string): UsageSnapshot => {
  const control = loadControl(dir)
  const counter = loadCounter(dir)
  return snapshot(control, counter)
}

export const setFreeUsageControl = (dir: string, next: Partial<UsageControl>): UsageSnapshot => {
  const control = {
    ...loadControl(dir),
    ...next,
  }
  control.dailyLimit = clampLimit(control.dailyLimit)
  write(storeKey(dir, "usage-control"), control)
  const counter = loadCounter(dir)
  write(storeKey(dir, "usage-counter"), counter)
  return snapshot(control, counter)
}

export const consumeFreeUsage = (dir: string) => {
  const control = loadControl(dir)
  const counter = loadCounter(dir)
  if (!control.enabled) return { allowed: true, snapshot: snapshot(control, counter), message: "" }
  if (counter.used >= control.dailyLimit) {
    const info = snapshot(control, counter)
    return {
      allowed: false,
      snapshot: info,
      message: `Free usage limit reached for today (${info.used}/${info.dailyLimit}).`,
    }
  }

  const next = {
    day: counter.day,
    used: counter.used + 1,
  }
  write(storeKey(dir, "usage-counter"), next)
  return { allowed: true, snapshot: snapshot(control, next), message: "" }
}
