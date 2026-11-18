import type { ParentProps } from "solid-js"
import { interpolate, lookup, translated, type Key } from "~/i18n"
import { useLanguage } from "~/context/language"
import { I18nContext } from "~/context/i18n-context"

export function I18nProvider(props: ParentProps) {
  const language = useLanguage()
  const value = {
    t(key: Key, params?: Record<string, string | number>) {
      return interpolate(lookup(language.locale(), key), params)
    },
    translated(key: Key) {
      return translated(language.locale(), key)
    },
  }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export { useI18n } from "~/context/i18n-context"
