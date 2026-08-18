import { loadLocaleDict, normalizeLocale, type Locale, type Platform } from "@opencode-ai/app"
import { storedLocaleValue } from "./locale-value"

export async function preloadStoredLocale(platform: Platform) {
  const raw = await platform.storage?.("opencode.global.dat").getItem("language")
  const locale = storedLocale(raw)
  if (!locale) return
  if (locale !== "en") await loadLocaleDict(locale)
  return locale
}

export function storedLocale(raw: string | null | undefined): Locale | undefined {
  const locale = storedLocaleValue(raw)
  if (!locale) return
  return normalizeLocale(locale)
}
