import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { dict as ko } from "@/i18n/ko"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { dict as uiZh } from "@opencode-ai/ui/i18n/zh"
import { dict as uiKo } from "@opencode-ai/ui/i18n/ko"

export type Locale = "en" | "zh" | "ko"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = ["en", "zh", "ko"]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh"
    if (language.toLowerCase().startsWith("ko")) return "ko"
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
      if (store.locale === "ko") return "ko"
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
      return { ...base, ...i18n.flatten({ ...ko, ...uiKo }) }
    })

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const labelKey: Record<Locale, keyof Dictionary> = {
      en: "language.en",
      zh: "language.zh",
      ko: "language.ko",
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
