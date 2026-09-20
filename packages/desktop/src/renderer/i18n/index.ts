import * as i18n from "@solid-primitives/i18n"
import type { DesktopNativeLocale } from "../../../../app/src/i18n/desktop-native"

import { dict as desktopEn } from "./en"

export type Locale = DesktopNativeLocale

type RawDictionary = typeof desktopEn
type Dictionary = Record<keyof i18n.Flatten<RawDictionary>, string>

// VeniceCode ships in English only. The lookup layer stays so copy keeps living in
// one dictionary instead of being scattered across call sites.
const dict = i18n.flatten(desktopEn) as Dictionary
const translate = i18n.translator(() => dict, i18n.resolveTemplate)

export function t(key: keyof Dictionary, params?: Record<string, string | number>) {
  return translate(key, params)
}

export function initI18n(): Promise<Locale> {
  return Promise.resolve("en")
}
