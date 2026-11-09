import { createMemo, useContext, type ParentProps } from "solid-js"
import { i18n, interpolate, type Key } from "~/i18n"
import { useLanguage } from "~/context/language"
import { I18nContext } from "~/context/i18n-context"

export function I18nProvider(props: ParentProps) {
  const language = useLanguage()
  const dict = createMemo(() => i18n(language.locale()))
  const value = {
    t(key: Key, params?: Record<string, string | number>) {
      return interpolate(dict()[key], params)
    },
  }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error("I18n context must be used within a context provider")
  return value
}
