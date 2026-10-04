import type { Key } from "~/i18n"
import type { useI18n } from "~/context/i18n"

type ResetTimeKeys = {
  day: Key
  days: Key
  hour: Key
  hours: Key
  minute: Key
  minutes: Key
  fewSeconds: Key
}

export const liteResetTimeKeys = {
  day: "workspace.lite.time.day",
  days: "workspace.lite.time.days",
  hour: "workspace.lite.time.hour",
  hours: "workspace.lite.time.hours",
  minute: "workspace.lite.time.minute",
  minutes: "workspace.lite.time.minutes",
  fewSeconds: "workspace.lite.time.fewSeconds",
} satisfies ResetTimeKeys

export const blackResetTimeKeys = {
  day: "workspace.black.time.day",
  days: "workspace.black.time.days",
  hour: "workspace.black.time.hour",
  hours: "workspace.black.time.hours",
  minute: "workspace.black.time.minute",
  minutes: "workspace.black.time.minutes",
  fewSeconds: "workspace.black.time.fewSeconds",
} satisfies ResetTimeKeys

export function formatResetTime(seconds: number, i18n: ReturnType<typeof useI18n>, keys: ResetTimeKeys) {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) {
    const hours = Math.floor((seconds % 86400) / 3600)
    return `${days} ${days === 1 ? i18n.t(keys.day) : i18n.t(keys.days)} ${hours} ${hours === 1 ? i18n.t(keys.hour) : i18n.t(keys.hours)}`
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours >= 1)
    return `${hours} ${hours === 1 ? i18n.t(keys.hour) : i18n.t(keys.hours)} ${minutes} ${minutes === 1 ? i18n.t(keys.minute) : i18n.t(keys.minutes)}`
  if (minutes === 0) return i18n.t(keys.fewSeconds)
  return `${minutes} ${minutes === 1 ? i18n.t(keys.minute) : i18n.t(keys.minutes)}`
}
