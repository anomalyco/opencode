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

export type Locale = "en" | "zh" | "zht" | "ko" | "de" | "es" | "fr" | "da" | "ja" | "pl" | "ru" | "ar" | "no" | "br"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = ["en", "zh", "zht", "ko", "de", "es", "fr", "da", "ja", "pl", "ru", "ar", "no", "br"]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) {
      if (language.toLowerCase().includes("hant")) return "zht"
      return "zh"
    }
    if (language.toLowerCase().startsWith("ko")) return "ko"
    if (language.toLowerCase().startsWith("de")) return "de"
    if (language.toLowerCase().startsWith("es")) return "es"
    if (language.toLowerCase().startsWith("fr")) return "fr"
    if (language.toLowerCase().startsWith("da")) return "da"
    if (language.toLowerCase().startsWith("ja")) return "ja"
    if (language.toLowerCase().startsWith("pl")) return "pl"
    if (language.toLowerCase().startsWith("ru")) return "ru"
    if (language.toLowerCase().startsWith("ar")) return "ar"
    if (
      language.toLowerCase().startsWith("no") ||
      language.toLowerCase().startsWith("nb") ||
      language.toLowerCase().startsWith("nn")
    )
      return "no"
    if (language.toLowerCase().startsWith("pt")) return "br"
  }

  return "en"
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

    const locale = createMemo<Locale>(() => {
      if (store.locale === "zh") return "zh"
      if (store.locale === "zht") return "zht"
      if (store.locale === "ko") return "ko"
      if (store.locale === "de") return "de"
      if (store.locale === "es") return "es"
      if (store.locale === "fr") return "fr"
      if (store.locale === "da") return "da"
      if (store.locale === "ja") return "ja"
      if (store.locale === "pl") return "pl"
      if (store.locale === "ru") return "ru"
      if (store.locale === "ar") return "ar"
      if (store.locale === "no") return "no"
      if (store.locale === "br") return "br"
      return "en"
    })

    createEffect(() => {
      const current = locale()
      if (store.locale === current) return
      setStore("locale", current)
    })

    const base = i18n.flatten({ ...en, ...uiEn })
    const dict = createMemo<Dictionary>(() => {
      if (locale() === "en") return base
      if (locale() === "zh") return { ...base, ...i18n.flatten({ ...zh, ...uiZh }) }
      if (locale() === "zht") return { ...base, ...i18n.flatten({ ...zht, ...uiZht }) }
      if (locale() === "de") return { ...base, ...i18n.flatten({ ...de, ...uiDe }) }
      if (locale() === "es") return { ...base, ...i18n.flatten({ ...es, ...uiEs }) }
      if (locale() === "fr") return { ...base, ...i18n.flatten({ ...fr, ...uiFr }) }
      if (locale() === "da") return { ...base, ...i18n.flatten({ ...da, ...uiDa }) }
      if (locale() === "ja") return { ...base, ...i18n.flatten({ ...ja, ...uiJa }) }
      if (locale() === "pl") return { ...base, ...i18n.flatten({ ...pl, ...uiPl }) }
      if (locale() === "ru") return { ...base, ...i18n.flatten({ ...ru, ...uiRu }) }
      if (locale() === "ar") return { ...base, ...i18n.flatten({ ...ar, ...uiAr }) }
      if (locale() === "no") return { ...base, ...i18n.flatten({ ...no, ...uiNo }) }
      if (locale() === "br") return { ...base, ...i18n.flatten({ ...br, ...uiBr }) }
      return { ...base, ...i18n.flatten({ ...ko, ...uiKo }) }
    })

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const labelKey: Record<Locale, keyof Dictionary> = {
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
    }

    const label = (value: Locale) => t(labelKey[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
    })

    return {
      ready,
      locale,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        setStore("locale", next)
      },
    }
  },
})
