import { dict } from "./en"
import type { Key } from "./en"

export type Dictionary = Record<Key, string>

// Read the source on every call so a later locale provider can supply reactive catalogs.
export function createI18n(source: () => Partial<Dictionary> = () => dict) {
  return {
    t: (key: Key) => source()[key] ?? dict[key],
  }
}

export const i18n = createI18n()
