import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { dict as zht } from "@/i18n/zht"
import { dict as ko } from "@/i18n/ko"
import { dict as de } from "@/i18n/de"
import { dict as es } from "@/i18n/es"
import { dict as fr } from "@/i18n/fr"
import { dict as da } from "@/i18n/da"
import { dict as ja } from "@/i18n/ja"
import { dict as pl } from "@/i18n/pl"
import { dict as ru } from "@/i18n/ru"
import { dict as ar } from "@/i18n/ar"
import { dict as no } from "@/i18n/no"
import { dict as br } from "@/i18n/br"
import { dict as th } from "@/i18n/th"
import { dict as bs } from "@/i18n/bs"
import { dict as tr } from "@/i18n/tr"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { dict as uiZh } from "@opencode-ai/ui/i18n/zh"
import { dict as uiZht } from "@opencode-ai/ui/i18n/zht"
import { dict as uiKo } from "@opencode-ai/ui/i18n/ko"
import { dict as uiDe } from "@opencode-ai/ui/i18n/de"
import { dict as uiEs } from "@opencode-ai/ui/i18n/es"
import { dict as uiFr } from "@opencode-ai/ui/i18n/fr"
import { dict as uiDa } from "@opencode-ai/ui/i18n/da"
import { dict as uiJa } from "@opencode-ai/ui/i18n/ja"
import { dict as uiPl } from "@opencode-ai/ui/i18n/pl"
import { dict as uiRu } from "@opencode-ai/ui/i18n/ru"
import { dict as uiAr } from "@opencode-ai/ui/i18n/ar"
import { dict as uiNo } from "@opencode-ai/ui/i18n/no"
import { dict as uiBr } from "@opencode-ai/ui/i18n/br"
import { dict as uiTh } from "@opencode-ai/ui/i18n/th"
import { dict as uiBs } from "@opencode-ai/ui/i18n/bs"
import { dict as uiTr } from "@opencode-ai/ui/i18n/tr"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "bs"
  | "tr"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "bs",
  "ar",
  "no",
  "br",
  "th",
  "tr",
]

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
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
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

const base = i18n.flatten({ ...en, ...uiEn })
const DICT: Record<Locale, Dictionary> = {
  en: base,
  zh: { ...base, ...i18n.flatten({ ...zh, ...uiZh }) },
  zht: { ...base, ...i18n.flatten({ ...zht, ...uiZht }) },
  ko: { ...base, ...i18n.flatten({ ...ko, ...uiKo }) },
  de: { ...base, ...i18n.flatten({ ...de, ...uiDe }) },
  es: { ...base, ...i18n.flatten({ ...es, ...uiEs }) },
  fr: { ...base, ...i18n.flatten({ ...fr, ...uiFr }) },
  da: { ...base, ...i18n.flatten({ ...da, ...uiDa }) },
  ja: { ...base, ...i18n.flatten({ ...ja, ...uiJa }) },
  pl: { ...base, ...i18n.flatten({ ...pl, ...uiPl }) },
  ru: { ...base, ...i18n.flatten({ ...ru, ...uiRu }) },
  ar: { ...base, ...i18n.flatten({ ...ar, ...uiAr }) },
  no: { ...base, ...i18n.flatten({ ...no, ...uiNo }) },
  br: { ...base, ...i18n.flatten({ ...br, ...uiBr }) },
  th: { ...base, ...i18n.flatten({ ...th, ...uiTh }) },
  bs: { ...base, ...i18n.flatten({ ...bs, ...uiBs }) },
  tr: { ...base, ...i18n.flatten({ ...tr, ...uiTr }) },
}

const localeMatchers: Array<{ locale: Locale; match: (language: string) => boolean }> = [
  { locale: "zht", match: (language) => language.startsWith("zh") && language.includes("hant") },
  { locale: "zh", match: (language) => language.startsWith("zh") },
  { locale: "ko", match: (language) => language.startsWith("ko") },
  { locale: "de", match: (language) => language.startsWith("de") },
  { locale: "es", match: (language) => language.startsWith("es") },
  { locale: "fr", match: (language) => language.startsWith("fr") },
  { locale: "da", match: (language) => language.startsWith("da") },
  { locale: "ja", match: (language) => language.startsWith("ja") },
  { locale: "pl", match: (language) => language.startsWith("pl") },
  { locale: "ru", match: (language) => language.startsWith("ru") },
  { locale: "ar", match: (language) => language.startsWith("ar") },
  {
    locale: "no",
    match: (language) => language.startsWith("no") || language.startsWith("nb") || language.startsWith("nn"),
  },
  { locale: "br", match: (language) => language.startsWith("pt") },
  { locale: "th", match: (language) => language.startsWith("th") },
  { locale: "bs", match: (language) => language.startsWith("bs") },
  { locale: "tr", match: (language) => language.startsWith("tr") },
]

type ParityKey = "command.session.previous.unseen" | "command.session.next.unseen"
const PARITY_CHECK: Record<Exclude<Locale, "en">, Record<ParityKey, string>> = {
  zh,
  zht,
  ko,
  de,
  es,
  fr,
  da,
  ja,
  pl,
  ru,
  ar,
  no,
  br,
  th,
  bs,
  tr,
}
void PARITY_CHECK

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

function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: detectLocale() as Locale,
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))

    const dict = createMemo<Dictionary>(() => DICT[locale()])

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      document.cookie = cookie(locale())
    })

    return {
      ready,
      locale,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
    }
  },
})
