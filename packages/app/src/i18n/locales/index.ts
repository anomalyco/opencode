import en from "./en"
import zhCN from "./zh-CN"
import ja from "./ja"
import fr from "./fr"
import es from "./es"

export const locales = {
  en,
  "zh-CN": zhCN,
  ja,
  fr,
  es,
} as const

export type Locale = keyof typeof locales
export const defaultLocale: Locale = "en"
export const supportedLocales: Locale[] = Object.keys(locales) as Locale[]

export type Translation = typeof locales[Locale]
