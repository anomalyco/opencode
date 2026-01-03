import en from "./en"
import ko from "./ko"

type TranslationKey = keyof typeof en
type SupportedLocale = "en" | "ko"

const translations: Record<string, Record<string, string>> = { en, ko }

function detectLocale(): SupportedLocale {
  const opencodeLang = process.env.OPENCODE_LANG
  if (opencodeLang) {
    if (opencodeLang.startsWith("ko")) return "ko"
    if (opencodeLang.startsWith("en")) return "en"
  }

  const lang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || ""
  if (lang.startsWith("ko")) return "ko"

  return "en"
}

let currentLocale: SupportedLocale = detectLocale()

export function setLanguage(locale: SupportedLocale): void {
  currentLocale = locale
}

export function t(key: TranslationKey | string, replacements?: Record<string, string> | string): string {
  const translation = translations[currentLocale]?.[key] ?? translations.en[key] ?? key

  if (!replacements) return translation

  if (typeof replacements === "string") {
    return translation.replace("{}", replacements)
  }

  return Object.entries(replacements).reduce((result, [placeholder, value]) => {
    return result.replace(new RegExp(`\\{${placeholder}\\}`, "g"), value)
  }, translation)
}

export function getLanguage(): SupportedLocale {
  return currentLocale
}

export function getSupportedLanguages(): SupportedLocale[] {
  return ["en", "ko"]
}

export function isKorean(): boolean {
  return currentLocale === "ko"
}

export { en, ko }
export type { SupportedLocale }
