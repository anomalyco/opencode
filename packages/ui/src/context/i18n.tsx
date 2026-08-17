import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { I18nProvider } from "@kobalte/core/i18n"
import { dict as en } from "../i18n/en"
import type { Key, LocaleKey, PluralCategory, PluralKey, PluralLookupKey } from "../i18n/en"

export type UiI18nKey = Key
export type UiI18nPluralKey = PluralKey
export type UiPluralCategory = PluralCategory
export type UiI18nPluralLookupKey = PluralLookupKey
export type UiI18nLocaleKey = LocaleKey
type UiTranslationKey<Value extends string> = Value extends UiI18nPluralLookupKey ? never : Value
export type UiI18nOrdinaryKey = UiTranslationKey<UiI18nKey>

export type UiI18nParams = Record<string, string | number | boolean>
export type UiTranslate = <Value extends string>(key: UiTranslationKey<Value>, params?: UiI18nParams) => string

export type UiI18nSource = {
  locale: Accessor<string>
  layoutLocale?: Accessor<string>
  t: UiTranslate
  plural: (key: UiI18nPluralKey, count: number, params?: UiI18nParams) => string
  pluralForm?: (key: UiI18nPluralKey, category: UiPluralCategory, params?: UiI18nParams) => string
}

export type UiI18n = UiI18nSource & {
  /** Preserve runtime-generated English copy while using the keyed dictionary for every other locale. */
  tDynamic: (key: UiI18nOrdinaryKey, source: string, params?: UiI18nParams) => string
}

const rules = new Map<string, Intl.PluralRules>()

export function pluralCategory(locale: string, count: number): UiPluralCategory {
  const cached = rules.get(locale)
  if (cached) return cached.select(count)
  const next = new Intl.PluralRules(locale)
  if (rules.size >= 32) rules.delete(rules.keys().next().value!)
  rules.set(locale, next)
  return next.select(count)
}

export function pluralKey(key: UiI18nPluralKey, category: UiPluralCategory) {
  return `${key}.${category}` as UiI18nPluralLookupKey
}

function resolveTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

export function createUiI18n(source: UiI18nSource): UiI18n {
  return {
    ...source,
    tDynamic: (key, value, params) =>
      source.locale().toLowerCase().split("-")[0] === "en" ? resolveTemplate(value, params) : source.t(key, params),
  }
}

const fallbackSource: UiI18nSource = {
  locale: () => "en",
  t: (key, params) => {
    const value = en[key as UiI18nKey] ?? String(key)
    return resolveTemplate(value, params)
  },
  plural: (key, count, params) =>
    fallback.pluralForm!(key, pluralCategory(fallback.locale(), count), { ...params, count }),
  pluralForm: (key, category, params) => {
    const values = en as Partial<Record<UiI18nLocaleKey, string>>
    const value = values[pluralKey(key, category)] ?? values[`${key}.other`] ?? `${key}.other`
    return resolveTemplate(value, params)
  },
}
const fallback = createUiI18n(fallbackSource)

const Context = createContext<UiI18n>(fallback)

function UiI18nProvider(props: ParentProps<{ value: UiI18nSource }>) {
  const value = createUiI18n(props.value)
  return (
    <I18nProvider locale={(value.layoutLocale ?? value.locale)()}>
      <Context.Provider value={value}>{props.children}</Context.Provider>
    </I18nProvider>
  )
}

export { UiI18nProvider as I18nProvider }

export function useI18n() {
  return useContext(Context)
}
