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

export const UI_RICH_KEYS = {
  "ui.lineComment.label": "selection",
  "ui.lineComment.editorLabel": "selection",
  "ui.list.emptyWithFilter": "query",
} as const
export type UiI18nRichKey = keyof typeof UI_RICH_KEYS
export type UiI18nRichSlot<K extends UiI18nRichKey> = (typeof UI_RICH_KEYS)[K]
export type UiI18nPart<T> = string | T

export type UiI18nSource = {
  locale: Accessor<string>
  layoutLocale?: Accessor<string>
  t: (key: UiI18nKey, params?: UiI18nParams) => string
  plural: (key: UiI18nPluralKey, count: number, params?: UiI18nParams) => string
}

export type UiI18n = UiI18nSource & {
  /** Preserve runtime-generated English copy while using the keyed dictionary for every other locale. */
  tDynamic: (key: UiI18nKey, source: string, params?: UiI18nParams) => string
  parts: <K extends UiI18nRichKey, S extends Record<UiI18nRichSlot<K>, unknown>>(
    key: K,
    slots: S,
  ) => UiI18nPart<S[UiI18nRichSlot<K>]>[]
  pluralParts: <T>(key: UiI18nPluralKey, count: number, slots: { count: T }, params?: UiI18nParams) => UiI18nPart<T>[]
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
  return `${key}.${category}`
}

function resolveTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

function resolveParts<T>(template: string, slot: string, value: T, params?: UiI18nParams): UiI18nPart<T>[] {
  const matches = Array.from(template.matchAll(/{{\s*([^}]+?)\s*}}/g)).filter((match) => match[1] === slot)
  if (matches.length !== 1) throw new Error(`Expected exactly one {{${slot}}} placeholder`)
  const match = matches[0]
  const index = match.index
  return [
    resolveTemplate(template.slice(0, index), params),
    value,
    resolveTemplate(template.slice(index + match[0].length), params),
  ]
}

export function createUiI18n(source: UiI18nSource): UiI18n {
  return {
    ...source,
    tDynamic: (key, value, params) =>
      source.locale().toLowerCase().split("-")[0] === "en" ? resolveTemplate(value, params) : source.t(key, params),
    parts: (key, slots) => {
      const slot = UI_RICH_KEYS[key]
      return resolveParts(source.t(key), slot, slots[slot])
    },
    pluralParts: (key, count, slots, params) =>
      resolveParts(source.t(pluralKey(key, pluralCategory(source.locale(), count))), "count", slots.count, params),
  }
}

const fallbackSource: UiI18nSource = {
  locale: () => "en",
  t: (key, params) => {
    const value = en[key] ?? key
    return resolveTemplate(value, params)
  },
  plural: (key, count, params) =>
    fallbackSource.t(pluralKey(key, pluralCategory(fallbackSource.locale(), count)), { ...params, count }),
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
