import { createSimpleContext } from "@opencode-ai/ui/context"
import { translate, type Key } from "../i18n"
import { useLanguage } from "./language"

export const { use: useI18n, provider: I18nProvider } = createSimpleContext({
  name: "StatsI18n",
  init: () => {
    const language = useLanguage()

    return {
      t(key: Key, params?: Record<string, string | number>) {
        return translate(language.locale(), key, params)
      },
    }
  },
})
