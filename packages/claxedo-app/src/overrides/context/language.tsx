import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { getExtensions } from "@opencode-ai/app-shared"
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

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

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
}
void PARITY_CHECK

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
    if (language.toLowerCase().startsWith("th")) return "th"
    if (language.toLowerCase().startsWith("bs")) return "bs"
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
      if (store.locale === "th") return "th"
      if (store.locale === "bs") return "bs"
      return "en"
    })

    createEffect(() => {
      const current = locale()
      if (store.locale === current) return
      setStore("locale", current)
    })

    // Capture extension strings once; extensions are registered before rendering.
    const ext = getExtensions()

    const base = i18n.flatten({ ...en, ...uiEn })
    const dict = createMemo<Dictionary>(() => {
      const current = locale()
      const extra = ext.app.strings?.[current] ?? {}

      if (current === "en") return { ...base, ...extra }
      if (current === "zh") return { ...base, ...i18n.flatten({ ...zh, ...uiZh }), ...extra }
      if (current === "zht") return { ...base, ...i18n.flatten({ ...zht, ...uiZht }), ...extra }
      if (current === "de") return { ...base, ...i18n.flatten({ ...de, ...uiDe }), ...extra }
      if (current === "es") return { ...base, ...i18n.flatten({ ...es, ...uiEs }), ...extra }
      if (current === "fr") return { ...base, ...i18n.flatten({ ...fr, ...uiFr }), ...extra }
      if (current === "da") return { ...base, ...i18n.flatten({ ...da, ...uiDa }), ...extra }
      if (current === "ja") return { ...base, ...i18n.flatten({ ...ja, ...uiJa }), ...extra }
      if (current === "pl") return { ...base, ...i18n.flatten({ ...pl, ...uiPl }), ...extra }
      if (current === "ru") return { ...base, ...i18n.flatten({ ...ru, ...uiRu }), ...extra }
      if (current === "ar") return { ...base, ...i18n.flatten({ ...ar, ...uiAr }), ...extra }
      if (current === "no") return { ...base, ...i18n.flatten({ ...no, ...uiNo }), ...extra }
      if (current === "br") return { ...base, ...i18n.flatten({ ...br, ...uiBr }), ...extra }
      if (current === "th") return { ...base, ...i18n.flatten({ ...th, ...uiTh }), ...extra }
      if (current === "bs") return { ...base, ...i18n.flatten({ ...bs, ...uiBs }), ...extra }
      return { ...base, ...i18n.flatten({ ...ko, ...uiKo }), ...extra }
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
      th: "language.th",
      bs: "language.bs",
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
