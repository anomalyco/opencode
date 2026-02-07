import type { Locale } from "./i18n-common"

export const extraLocaleKeysAllowlist: Partial<Record<Locale, readonly string[]>> = {}

export const uiLiteralAllowlist: readonly string[] = []

export const uiBlockedPhraseAllowlist: Partial<Record<string, readonly string[]>> = {}
