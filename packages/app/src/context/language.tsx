import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
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

export function LanguageProvider(props: ParentProps) {
  const [language, setLanguage] = createSignal<Language>(getStoredLanguage() ?? "en")

  function setLanguageWithStorage(lang: Language) {
    setLanguage(lang)
    try {
      if (typeof localStorage === "undefined") return
      localStorage.setItem("opencode-language", lang)
    } catch {
      // Ignore storage failures (e.g. SSR or restricted environments).
    }
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

function getStoredLanguage(): Language | null {
  try {
    if (typeof localStorage === "undefined") return null
    const stored = localStorage.getItem("opencode-language")
    return stored === "en" || stored === "zh" ? stored : null
  } catch {
    return null
  }
}
