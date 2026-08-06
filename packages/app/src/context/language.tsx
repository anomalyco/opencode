import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { pluralCategory, type UiI18nPluralKey } from "@opencode-ai/ui/context/i18n"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import {
  createDesktopNativeBundle,
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_LOCALES,
  type DesktopNativeBundle,
  type DesktopNativeLocale,
} from "@/i18n/desktop-native"

export type Locale = DesktopNativeLocale
export type Direction = "ltr" | "rtl"

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ar", "ur", "pa"])

function localeDirection(locale: Locale): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr"
}

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>
type PluralKey =
  | UiI18nPluralKey
  | "session.question.pending"
  | "session.followupDock.summary"
  | "session.revertDock.summary"
type Source = { dict: Record<string, string> }

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = DESKTOP_NATIVE_LOCALES

const INTL: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  zht: "zh-Hant",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  uk: "uk",
  ar: "ar",
  no: "nb-NO",
  br: "pt-BR",
  th: "th",
  bs: "bs",
  tr: "tr",
  hi: "hi-IN",
  nl: "nl-NL",
  id: "id-ID",
  vi: "vi-VN",
  it: "it-IT",
  ur: "ur-PK",
  pa: "pa-Arab-PK",
  az: "az-Latn-AZ",
  fi: "fi-FI",
  sv: "sv-SE",
}

const LABEL_KEY: Partial<Record<Locale, keyof Dictionary>> = {
  en: "language.en",
  zh: "language.zh",
  zht: "language.zht",
  ko: "language.ko",
  de: "language.de",
  es: "language.es",
  fr: "language.fr",
  da: "language.da",
  ja: "language.ja",
  pl: "language.pl",
  ru: "language.ru",
  uk: "language.uk",
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

const LABEL: Partial<Record<Locale, string>> = {
  hi: "हिन्दी",
  nl: "Nederlands",
  id: "Bahasa Indonesia",
  vi: "Tiếng Việt",
  it: "Italiano",
  ur: "اردو",
  pa: "پنجابی",
  az: "Azərbaycanca",
  fi: "Suomi",
  sv: "Svenska",
}

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

const localeMatchers: Array<{ locale: Locale; match: (language: string) => boolean }> = [
  { locale: "en", match: (language) => language.startsWith("en") },
  {
    locale: "zht",
    match: (language) =>
      language.startsWith("zh") &&
      (language.includes("hant") || language.includes("-tw") || language.includes("-hk") || language.includes("-mo")),
  },
  { locale: "zh", match: (language) => language.startsWith("zh") },
  { locale: "ko", match: (language) => language.startsWith("ko") },
  { locale: "de", match: (language) => language.startsWith("de") },
  { locale: "es", match: (language) => language.startsWith("es") },
  { locale: "fr", match: (language) => language.startsWith("fr") },
  { locale: "da", match: (language) => language.startsWith("da") },
  { locale: "ja", match: (language) => language.startsWith("ja") },
  { locale: "pl", match: (language) => language.startsWith("pl") },
  { locale: "ru", match: (language) => language.startsWith("ru") },
  { locale: "uk", match: (language) => language.startsWith("uk") },
  { locale: "ar", match: (language) => language.startsWith("ar") },
  {
    locale: "no",
    match: (language) => language.startsWith("no") || language.startsWith("nb") || language.startsWith("nn"),
  },
  { locale: "br", match: (language) => language.startsWith("pt") },
  { locale: "th", match: (language) => language.startsWith("th") },
  { locale: "bs", match: (language) => language.startsWith("bs") },
  { locale: "tr", match: (language) => language.startsWith("tr") },
  { locale: "hi", match: (language) => language.startsWith("hi") },
  { locale: "nl", match: (language) => language.startsWith("nl") },
  { locale: "id", match: (language) => language.startsWith("id") },
  { locale: "vi", match: (language) => language.startsWith("vi") },
  { locale: "it", match: (language) => language.startsWith("it") },
  { locale: "ur", match: (language) => language.startsWith("ur") },
  {
    locale: "pa",
    match: (language) => language.startsWith("pa") && (language.includes("arab") || language.includes("-pk")),
  },
  {
    locale: "az",
    match: (language) => language.startsWith("az") && !language.includes("arab") && !language.includes("cyrl"),
  },
  { locale: "fi", match: (language) => language.startsWith("fi") },
  { locale: "sv", match: (language) => language.startsWith("sv") },
]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    const normalized = language.toLowerCase()
    const match = localeMatchers.find((entry) => entry.match(normalized))
    if (match) return match.locale
  }

  return "en"
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
if (warm !== "en") void loadDict(warm)

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  gate: false,
  init: (props: { locale?: Locale; onNativeTranslations?: (bundle: DesktopNativeBundle) => void }) => {
    const initial = props.locale ?? readStoredLocale() ?? detectLocale()
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
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

    const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate) as (
      key: keyof Dictionary,
      params?: Record<string, string | number | boolean>,
    ) => string

    const plural = (key: PluralKey, count: number, params?: Record<string, string | number | boolean>) => {
      const category = pluralCategory(intl(), count)
      const current = (dict.loading ? base : (dict() ?? base)) as Record<string, string>
      const candidate = `${key}.${category}`
      const fallback = `${key}.other`
      return i18n.resolveTemplate(current[candidate] ?? current[fallback] ?? fallback, { ...params, count })
    }

    const label = (value: Locale) => {
      const key = LABEL_KEY[value]
      if (key) return t(key)
      return LABEL[value] ?? value
    }

    createEffect(() => {
      if (typeof document !== "object") return
      const value = locale()
      document.documentElement.lang = value
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
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
      setDirection(next: Direction) {
        setLayout("direction", next === localeDirection(locale()) ? undefined : next)
      },
    }
  },
})
