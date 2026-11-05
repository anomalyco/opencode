import { createContext } from "solid-js"
import type { Key } from "~/i18n"

export type I18n = { t(key: Key, params?: Record<string, string | number>): string }

/**
 * The I18n context on its own, with no runtime imports: when a translator edits a dict, the dev
 * server reloads src/context/i18n.tsx (it imports the dicts) but keeps this module, so the provider
 * the app already rendered and the pages that reloaded still share one context.
 */
export const I18nContext = createContext<I18n>()
