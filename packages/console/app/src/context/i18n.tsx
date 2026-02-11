import { createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { i18n, type Key } from "~/i18n"
import { useLanguage } from "~/context/language"

function resolve(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key) => {
    const value = params[key]
    if (value === undefined || value === null) return raw
    return String(value)
  })
}

export const { use: useI18n, provider: I18nProvider } = createSimpleContext({
  name: "I18n",
  init: () => {
    const language = useLanguage()
    const dict = createMemo(() => i18n(language.locale()))

    return {
      t(key: Key, params?: Record<string, string | number>) {
        return resolve(dict()[key], params)
      },
    }
  },
})
