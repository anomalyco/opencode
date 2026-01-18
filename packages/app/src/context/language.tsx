import { createContext, createSignal, useContext, type Accessor } from "solid-js"
import enTranslations from "@/locales/en.json"
import zhTranslations from "@/locales/zh.json"

export type Language = "en" | "zh"

export interface LanguageContextType {
  language: Accessor<Language>
  setLanguage: (language: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType>()

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}

export function LanguageProvider(props: { children: any }) {
  const [language, setLanguage] = createSignal<Language>(
    (localStorage.getItem("opencode-language") as Language) ?? "en",
  )

  function setLanguageWithStorage(lang: Language) {
    setLanguage(lang)
    localStorage.setItem("opencode-language", lang)
  }

  async function loadTranslations(lang: Language) {
    const translations = await import(`../locales/${lang}.json`)
    return translations.default
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const lang = language()
    const keys = key.split(".")
    const translations: Record<Language, Record<string, any>> = {
      en: enTranslations,
      zh: zhTranslations,
    }

    let value: any = translations[lang]
    for (const k of keys) {
      value = value?.[k]
    }

    if (typeof value !== "string") {
      // Fallback to English if translation not found
      value = translations.en
      for (const k of keys) {
        value = value?.[k]
      }
    }

    if (typeof value !== "string") {
      return key // Return the key if no translation found
    }

    // Replace parameters in the translation
    if (params) {
      return value.replace(/\{(\w+)\}/g, (match: string, param: string) => {
        return params[param]?.toString() || match
      })
    }

    return value
  }

  const value: LanguageContextType = {
    language,
    setLanguage: setLanguageWithStorage,
    t,
  }

  return <LanguageContext.Provider value={value}>{props.children}</LanguageContext.Provider>
}
