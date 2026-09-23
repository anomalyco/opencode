import { loadLocaleDict, normalizeLocale, type Locale, type Platform } from "@opencode/app/desktop"
import { storedLocaleValue } from "./locale-value"

// The stored language lives in the main process's SQLite store, behind the IPC port. A copy of the
// last answer in localStorage lets the shell mount without waiting for the port; the store is still
// asked every launch and the copy refreshed, and the language provider hydrates from the store
// itself, so a stale copy costs one visible switch, not a wrong language.
const cacheKey = "opencode.desktop.language"

export async function preloadStoredLocale(platform: Platform) {
  const fresh = Promise.resolve(platform.storage?.("opencode.global.dat").getItem("language")).then(
    (raw) => {
      localStorage.setItem(cacheKey, raw ?? "")
      return raw
    },
    () => undefined,
  )
  const cached = localStorage.getItem(cacheKey)
  const locale = storedLocale(cached ?? (await fresh))
  if (!locale) return
  if (locale !== "en") await loadLocaleDict(locale)
  return locale
}

export function storedLocale(raw: string | null | undefined): Locale | undefined {
  const locale = storedLocaleValue(raw)
  if (!locale) return
  return normalizeLocale(locale)
}
