import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { I18nProvider } from "@kobalte/core/i18n"
import { dict as en } from "../i18n/en"

export type UiI18nKey = keyof typeof en

export const UI_PLURAL_KEYS = [
  "ui.sessionTurn.diffs.changed",
  "ui.messagePart.context.read",
  "ui.messagePart.context.search",
  "ui.messagePart.context.list",
] as const
export type UiI18nPluralKey = (typeof UI_PLURAL_KEYS)[number]
export type UiPluralCategory = "zero" | "one" | "two" | "few" | "many" | "other"
export type UiI18nPluralLookupKey = `${UiI18nPluralKey}.${UiPluralCategory}`

export type UiI18nParams = Record<string, string | number | boolean>

export type UiI18n = {
  locale: Accessor<string>
  layoutLocale?: Accessor<string>
  t: (key: UiI18nKey, params?: UiI18nParams) => string
  plural: (key: UiI18nPluralKey, count: number, params?: UiI18nParams) => string
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

const fallback: UiI18n = {
  locale: () => "en",
  t: (key, params) => {
    const value = en[key] ?? String(key)
    return resolveTemplate(value, params)
  },
  plural: (key, count, params) =>
    fallback.t(pluralKey(key, pluralCategory(fallback.locale(), count)), { ...params, count }),
}

const Context = createContext<UiI18n>(fallback)

function UiI18nProvider(props: ParentProps<{ value: UiI18n }>) {
  return (
    <I18nProvider locale={(props.value.layoutLocale ?? props.value.locale)()}>
      <Context.Provider value={props.value}>{props.children}</Context.Provider>
    </I18nProvider>
  )
}

export { UiI18nProvider as I18nProvider }

export function useI18n() {
  return useContext(Context)
}
