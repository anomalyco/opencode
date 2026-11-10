import { createContext, useContext } from "solid-js"
import type { Key } from "~/i18n"

export type I18n = {
  t(key: Key, params?: Record<string, string | number>): string
  /** False while the page's language still shows the English for `key`. */
  translated(key: Key): boolean
}

/**
 * The I18n context on its own, with no runtime imports: when a translator edits a dict, the dev
 * server reloads src/context/i18n.tsx (it imports the dicts) but keeps this module, so the provider
 * the app already rendered and the pages that reloaded still share one context.
 */
export const I18nContext = createContext<I18n>()

/** The page's translations. Here rather than in i18n.tsx, so a component can read them without the language provider's router. */
export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error("I18n context must be used within a context provider")
  return value
}
