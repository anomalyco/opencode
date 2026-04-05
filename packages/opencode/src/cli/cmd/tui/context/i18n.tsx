import { createSimpleContext } from "./helper"
import { resolveLocale, t } from "@/i18n"
import { useSync } from "./sync"

export const { use: useI18n, provider: I18nProvider } = createSimpleContext({
  name: "I18n",
  init: () => {
    const sync = useSync()
    return {
      locale: () => resolveLocale(sync.data.config.locale),
      t(key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) {
        return t(resolveLocale(sync.data.config.locale), key, params)
      },
    }
  },
})
