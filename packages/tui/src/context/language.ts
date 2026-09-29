import { createResource } from "solid-js"
import { useConfig } from "../config"
import { createLanguage, dictionary, loadDictionary, type Locale } from "../i18n/translate"

/** Config owns persistence and reactive updates, including edits from another TUI. */
export function useLanguage() {
  const config = useConfig()
  const locale = () => config.data.language ?? "en"
  const [current] = createResource(locale, loadDictionary, { initialValue: dictionary(locale()) })
  return {
    ...createLanguage(locale, () => current() ?? dictionary(locale())),
    setLocale: async (locale: Locale) => {
      // Load first so a selection does not briefly replace translated text with English.
      await loadDictionary(locale)
      return config.update((draft) => {
        draft.language = locale
      })
    },
  }
}
