import { resolveTemplate, translator } from "@solid-primitives/i18n"
import en from "./en"

import { locales, labels, tags, type Locale } from "./locales"
import { loaders } from "./loaders"

export type { Locale } from "./locales"
export type TranslationKey = keyof typeof en

type PluralKey = {
  [Key in TranslationKey]: Key extends `${infer Base}.other`
    ? `${Base}.one` extends TranslationKey
      ? Base
      : never
    : never
}[TranslationKey]

export { locales } from "./locales"
export type Dictionary = Record<TranslationKey, string> & Record<string, string>
const dictionaries = new Map<Locale, Dictionary>()
const pending = new Map<Locale, Promise<Dictionary>>()

export function dictionary(locale: Locale) {
  return dictionaries.get(locale) ?? en
}

export function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === "en") return Promise.resolve(en)
  const existing = dictionaries.get(locale)
  if (existing) return Promise.resolve(existing)
  const loading = pending.get(locale)
  if (loading) return loading
  const result = loaders[locale]()
    .then((source) => {
      const dict = { ...en, ...source.dict }
      dictionaries.set(locale, dict)
      return dict
    })
    .finally(() => pending.delete(locale))
  pending.set(locale, result)
  return result
}

export function createLanguage(locale: () => Locale, currentDictionary: () => Dictionary = () => dictionary(locale())) {
  const intl = () => tags[locale()]
  return {
    locale,
    intl,
    locales,
    label: (value: Locale) => labels[value],
    t: translator(currentDictionary, resolveTemplate),
    plural: (key: PluralKey, count: number) => {
      const category = new Intl.PluralRules(intl()).select(count)
      const current = currentDictionary()
      return resolveTemplate(current[`${key}.${category}`] ?? current[`${key}.other`] ?? key, {
        count: new Intl.NumberFormat(intl()).format(count),
      })
    },
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(intl(), options).format(value),
    duration: (value: number) => {
      const format = (value: number, unit: string, minimumFractionDigits = 0) =>
        new Intl.NumberFormat(intl(), {
          style: "unit",
          unit,
          unitDisplay: "narrow",
          minimumFractionDigits,
          maximumFractionDigits: minimumFractionDigits,
        }).format(value)
      if (value < 1000) return format(value, "millisecond")
      if (value < 60000) return format(value / 1000, "second", 1)
      if (value < 3600000)
        return `${format(Math.floor(value / 60000), "minute")} ${format(Math.floor((value % 60000) / 1000), "second")}`
      if (value < 86400000)
        return `${format(Math.floor(value / 3600000), "hour")} ${format(Math.floor((value % 3600000) / 60000), "minute")}`
      return `${format(Math.floor(value / 86400000), "day")} ${format(Math.floor((value % 86400000) / 3600000), "hour")}`
    },
    date: (value: number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(intl(), options).format(value),
  }
}
