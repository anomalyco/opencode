import { createContext, useContext, Accessor, Setter, createSignal, createRoot } from "solid-js"
import { useStorage } from "@solid-primitives/storage"
import { locales, type Locale, type Translation, defaultLocale, supportedLocales } from "./locales"

type I18nContextValue = {
  locale: Accessor<Locale>
  setLocale: Setter<Locale>
  t: Accessor<Translation>
  locales: typeof supportedLocales
}

const I18nContext = createContext<I18nContextValue>()

export function I18nProvider(props: { children: any }) {
  const [locale, setLocale] = createSignal<Locale>(defaultLocale)

  // Initialize from localStorage or browser language
  const initializeLocale = () => {
    const stored = localStorage.getItem("opencode-locale") as Locale | null
    if (stored && supportedLocales.includes(stored)) {
      setLocale(stored)
      return
    }

    // Detect browser language
    const browserLang = navigator.language
    if (browserLang.startsWith("zh")) {
      setLocale("zh-CN")
    } else if (browserLang.startsWith("ja")) {
      setLocale("ja")
    } else if (browserLang.startsWith("fr")) {
      setLocale("fr")
    } else if (browserLang.startsWith("es")) {
      setLocale("es")
    }
  }
  initializeLocale()

  // Persist locale changes
  const persistLocale: Setter<Locale> = (...args) => {
    const result = setLocale(...args)
    const newLocale = locale()
    localStorage.setItem("opencode-locale", newLocale)
    return result
  }

  const t = () => locales[locale()]

  const value: I18nContextValue = {
    locale,
    setLocale: persistLocale,
    t,
    locales: supportedLocales,
  }

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider")
  }
  return context
}

// Helper to get nested translation values
export function useT() {
  const { t } = useI18n()
  return t
}
