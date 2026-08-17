import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  pluralCategory,
  type UiI18nPluralLookupKey,
  type UiI18nPluralKey,
  type UiPluralCategory,
} from "@opencode-ai/ui/context/i18n"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import {
  createDesktopNativeBundle,
  detectDesktopNativeLocale,
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_LABELS,
  DESKTOP_NATIVE_LOCALES,
  DESKTOP_NATIVE_LOCALE_TAGS,
  type DesktopNativeBundle,
  type DesktopNativeLocale,
} from "@/i18n/desktop-native"

export type Locale = DesktopNativeLocale
export type Direction = "ltr" | "rtl"

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ar", "he", "ur", "pa", "fa", "dv"])

function localeDirection(locale: Locale): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr"
}

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>
type AppI18nKey = Extract<keyof typeof en, string>
type AppI18nPluralKey = {
  [Key in AppI18nKey]: Key extends `${infer Base}.other` ? (`${Base}.one` extends AppI18nKey ? Base : never) : never
}[AppI18nKey]
type PluralKey = AppI18nPluralKey | UiI18nPluralKey
type AppI18nPluralLookupKey = `${AppI18nPluralKey}.${UiPluralCategory}`
type TranslationKey<Key extends Extract<keyof Dictionary, string>> = Key extends
  | AppI18nPluralLookupKey
  | UiI18nPluralLookupKey
  ? never
  : Key
type Source = { dict: Record<string, string> }

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = DESKTOP_NATIVE_LOCALES

const INTL = DESKTOP_NATIVE_LOCALE_TAGS

const base = i18n.flatten({ ...en, ...uiEn })
const dicts = new Map<Locale, Dictionary>([["en", base]])

const merge = (app: Promise<Source>, ui: Promise<Source>) =>
  Promise.all([app, ui]).then(([a, b]) => ({ ...base, ...i18n.flatten({ ...a.dict, ...b.dict }) }) as Dictionary)

const loaders: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  zh: () => merge(import("@/i18n/zh"), import("@opencode-ai/ui/i18n/zh")),
  zht: () => merge(import("@/i18n/zht"), import("@opencode-ai/ui/i18n/zht")),
  ko: () => merge(import("@/i18n/ko"), import("@opencode-ai/ui/i18n/ko")),
  de: () => merge(import("@/i18n/de"), import("@opencode-ai/ui/i18n/de")),
  es: () => merge(import("@/i18n/es"), import("@opencode-ai/ui/i18n/es")),
  fr: () => merge(import("@/i18n/fr"), import("@opencode-ai/ui/i18n/fr")),
  da: () => merge(import("@/i18n/da"), import("@opencode-ai/ui/i18n/da")),
  ja: () => merge(import("@/i18n/ja"), import("@opencode-ai/ui/i18n/ja")),
  pl: () => merge(import("@/i18n/pl"), import("@opencode-ai/ui/i18n/pl")),
  ru: () => merge(import("@/i18n/ru"), import("@opencode-ai/ui/i18n/ru")),
  uk: () => merge(import("@/i18n/uk"), import("@opencode-ai/ui/i18n/uk")),
  ar: () => merge(import("@/i18n/ar"), import("@opencode-ai/ui/i18n/ar")),
  he: () => merge(import("@/i18n/he"), import("@opencode-ai/ui/i18n/he")),
  no: () => merge(import("@/i18n/no"), import("@opencode-ai/ui/i18n/no")),
  br: () => merge(import("@/i18n/br"), import("@opencode-ai/ui/i18n/br")),
  th: () => merge(import("@/i18n/th"), import("@opencode-ai/ui/i18n/th")),
  bs: () => merge(import("@/i18n/bs"), import("@opencode-ai/ui/i18n/bs")),
  tr: () => merge(import("@/i18n/tr"), import("@opencode-ai/ui/i18n/tr")),
  hi: () => merge(import("@/i18n/hi"), import("@opencode-ai/ui/i18n/hi")),
  nl: () => merge(import("@/i18n/nl"), import("@opencode-ai/ui/i18n/nl")),
  id: () => merge(import("@/i18n/id"), import("@opencode-ai/ui/i18n/id")),
  vi: () => merge(import("@/i18n/vi"), import("@opencode-ai/ui/i18n/vi")),
  it: () => merge(import("@/i18n/it"), import("@opencode-ai/ui/i18n/it")),
  ur: () => merge(import("@/i18n/ur"), import("@opencode-ai/ui/i18n/ur")),
  pa: () => merge(import("@/i18n/pa"), import("@opencode-ai/ui/i18n/pa")),
  az: () => merge(import("@/i18n/az"), import("@opencode-ai/ui/i18n/az")),
  fi: () => merge(import("@/i18n/fi"), import("@opencode-ai/ui/i18n/fi")),
  sv: () => merge(import("@/i18n/sv"), import("@opencode-ai/ui/i18n/sv")),
  am: () => merge(import("@/i18n/am"), import("@opencode-ai/ui/i18n/am")),
  bg: () => merge(import("@/i18n/bg"), import("@opencode-ai/ui/i18n/bg")),
  bn: () => merge(import("@/i18n/bn"), import("@opencode-ai/ui/i18n/bn")),
  ca: () => merge(import("@/i18n/ca"), import("@opencode-ai/ui/i18n/ca")),
  cs: () => merge(import("@/i18n/cs"), import("@opencode-ai/ui/i18n/cs")),
  dv: () => merge(import("@/i18n/dv"), import("@opencode-ai/ui/i18n/dv")),
  dz: () => merge(import("@/i18n/dz"), import("@opencode-ai/ui/i18n/dz")),
  el: () => merge(import("@/i18n/el"), import("@opencode-ai/ui/i18n/el")),
  et: () => merge(import("@/i18n/et"), import("@opencode-ai/ui/i18n/et")),
  fa: () => merge(import("@/i18n/fa"), import("@opencode-ai/ui/i18n/fa")),
  fo: () => merge(import("@/i18n/fo"), import("@opencode-ai/ui/i18n/fo")),
  hr: () => merge(import("@/i18n/hr"), import("@opencode-ai/ui/i18n/hr")),
  hu: () => merge(import("@/i18n/hu"), import("@opencode-ai/ui/i18n/hu")),
  hy: () => merge(import("@/i18n/hy"), import("@opencode-ai/ui/i18n/hy")),
  is: () => merge(import("@/i18n/is"), import("@opencode-ai/ui/i18n/is")),
  ka: () => merge(import("@/i18n/ka"), import("@opencode-ai/ui/i18n/ka")),
  km: () => merge(import("@/i18n/km"), import("@opencode-ai/ui/i18n/km")),
  lo: () => merge(import("@/i18n/lo"), import("@opencode-ai/ui/i18n/lo")),
  lt: () => merge(import("@/i18n/lt"), import("@opencode-ai/ui/i18n/lt")),
  lv: () => merge(import("@/i18n/lv"), import("@opencode-ai/ui/i18n/lv")),
  mk: () => merge(import("@/i18n/mk"), import("@opencode-ai/ui/i18n/mk")),
  mn: () => merge(import("@/i18n/mn"), import("@opencode-ai/ui/i18n/mn")),
  ms: () => merge(import("@/i18n/ms"), import("@opencode-ai/ui/i18n/ms")),
  my: () => merge(import("@/i18n/my"), import("@opencode-ai/ui/i18n/my")),
  ne: () => merge(import("@/i18n/ne"), import("@opencode-ai/ui/i18n/ne")),
  ro: () => merge(import("@/i18n/ro"), import("@opencode-ai/ui/i18n/ro")),
  si: () => merge(import("@/i18n/si"), import("@opencode-ai/ui/i18n/si")),
  sk: () => merge(import("@/i18n/sk"), import("@opencode-ai/ui/i18n/sk")),
  sl: () => merge(import("@/i18n/sl"), import("@opencode-ai/ui/i18n/sl")),
  sq: () => merge(import("@/i18n/sq"), import("@opencode-ai/ui/i18n/sq")),
  sr: () => merge(import("@/i18n/sr"), import("@opencode-ai/ui/i18n/sr")),
  tg: () => merge(import("@/i18n/tg"), import("@opencode-ai/ui/i18n/tg")),
  tk: () => merge(import("@/i18n/tk"), import("@opencode-ai/ui/i18n/tk")),
  uz: () => merge(import("@/i18n/uz"), import("@opencode-ai/ui/i18n/uz")),
}

function loadDict(locale: Locale) {
  const hit = dicts.get(locale)
  if (hit) return Promise.resolve(hit)
  if (locale === "en") return Promise.resolve(base)
  const load = loaders[locale]
  return load().then((next: Dictionary) => {
    dicts.set(locale, next)
    return next
  })
}

export function loadLocaleDict(locale: Locale) {
  return loadDict(locale).then(() => undefined)
}

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"
  return detectDesktopNativeLocale(navigator.languages?.length ? navigator.languages : [navigator.language])
}

export function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

function readStoredLocale() {
  if (typeof localStorage !== "object") return
  try {
    const raw = localStorage.getItem("opencode.global.dat:language")
    if (!raw) return
    const next = JSON.parse(raw) as { locale?: string }
    if (typeof next?.locale !== "string") return
    return normalizeLocale(next.locale)
  } catch {
    return
  }
}

const warm = readStoredLocale() ?? detectLocale()
const initialLocale =
  warm === "en"
    ? Promise.resolve(warm)
    : loadDict(warm).then(
        () => warm,
        () => "en" as const,
      )

export function loadInitialLocale() {
  return initialLocale
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  gate: false,
  init: (props: { locale?: Locale; onNativeTranslations?: (bundle: DesktopNativeBundle) => void }) => {
    const initial = props.locale ?? readStoredLocale() ?? detectLocale()
    const [store, setStore, _, ready] = persisted(
      Persist.global("language"),
      createStore({
        locale: initial,
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))
    const intl = createMemo(() => INTL[locale()])
    const [layout, setLayout] = createStore({ direction: undefined as Direction | undefined })
    const direction = createMemo(() => layout.direction ?? localeDirection(locale()))
    const layoutLocale = createMemo(() => {
      if (!layout.direction) return intl()
      // Kobalte derives menu direction from locale rather than accepting a direction override.
      return layout.direction === "rtl" ? "ar" : "en"
    })

    const [dict] = createResource(locale, loadDict, {
      initialValue: dicts.get(initial) ?? base,
    })

    const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate) as <
      Key extends Extract<keyof Dictionary, string>,
    >(
      key: TranslationKey<Key>,
      params?: Record<string, string | number | boolean>,
    ) => string

    const pluralForm = (
      key: PluralKey,
      category: UiPluralCategory,
      params?: Record<string, string | number | boolean>,
    ) => {
      const current = (dict.loading ? base : (dict() ?? base)) as Record<string, string>
      const candidate = `${key}.${category}`
      const fallback = `${key}.other`
      return i18n.resolveTemplate(current[candidate] ?? current[fallback] ?? fallback, params)
    }
    const plural = (key: PluralKey, count: number, params?: Record<string, string | number | boolean>) =>
      pluralForm(key, pluralCategory(intl(), count), { ...params, count })

    const label = (value: Locale) => DESKTOP_NATIVE_LABELS[value]

    createEffect(() => {
      if (typeof document !== "object") return
      const value = locale()
      document.documentElement.lang = intl()
      document.documentElement.dir = direction()
      document.cookie = cookie(value)
    })

    createEffect(() => {
      if (!props.onNativeTranslations || dict.loading) return
      const current = dict()
      if (!current) return
      props.onNativeTranslations(
        createDesktopNativeBundle(locale(), (key) => current[key] ?? DESKTOP_NATIVE_ENGLISH[key]),
      )
    })

    return {
      ready,
      locale,
      intl,
      direction,
      layoutLocale,
      locales: LOCALES,
      label,
      t,
      plural,
      pluralForm,
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
      setDirection(next: Direction) {
        setLayout("direction", next === localeDirection(locale()) ? undefined : next)
      },
    }
  },
})
