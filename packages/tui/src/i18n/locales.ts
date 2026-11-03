export const locales = ["en", "ru"] as const

export type Locale = (typeof locales)[number]

export const labels: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
}

export const tags: Record<Locale, string> = {
  en: "en-US",
  ru: "ru-RU",
}
