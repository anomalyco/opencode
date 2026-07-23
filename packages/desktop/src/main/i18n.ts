import { app } from "electron"
import * as i18n from "@solid-primitives/i18n"
import { getStore } from "./store"

import { dict as en } from "../renderer/i18n/en"
import { dict as zh } from "../renderer/i18n/zh"
import { dict as zht } from "../renderer/i18n/zht"
import { dict as ko } from "../renderer/i18n/ko"
import { dict as de } from "../renderer/i18n/de"
import { dict as es } from "../renderer/i18n/es"
import { dict as fr } from "../renderer/i18n/fr"
import { dict as ja } from "../renderer/i18n/ja"
import { dict as da } from "../renderer/i18n/da"
import { dict as pl } from "../renderer/i18n/pl"
import { dict as ru } from "../renderer/i18n/ru"
import { dict as uk } from "../renderer/i18n/uk"
import { dict as ar } from "../renderer/i18n/ar"
import { dict as no } from "../renderer/i18n/no"
import { dict as br } from "../renderer/i18n/br"
import { dict as bs } from "../renderer/i18n/bs"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "uk"
  | "ar"
  | "no"
  | "br"
  | "bs"

type RawDictionary = typeof en
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "uk",
  "bs",
  "ar",
  "no",
  "br",
]

function parseLocale(value: unknown): Locale | null {
  if (!value || typeof value !== "string") return null
  if ((LOCALES as readonly string[]).includes(value)) return value as Locale
  return null
}

function detectLocale(): Locale {
  const electronLocale = app.getLocale()
  if (electronLocale.startsWith("zh")) {
    if (electronLocale.includes("Hant") || electronLocale === "zh-TW" || electronLocale === "zh-HK") return "zht"
    return "zh"
  }
  if (electronLocale.startsWith("ko")) return "ko"
  if (electronLocale.startsWith("de")) return "de"
  if (electronLocale.startsWith("es")) return "es"
  if (electronLocale.startsWith("fr")) return "fr"
  if (electronLocale.startsWith("da")) return "da"
  if (electronLocale.startsWith("ja")) return "ja"
  if (electronLocale.startsWith("pl")) return "pl"
  if (electronLocale.startsWith("ru")) return "ru"
  if (electronLocale.startsWith("uk")) return "uk"
  if (electronLocale.startsWith("ar")) return "ar"
  if (electronLocale.startsWith("no") || electronLocale.startsWith("nb") || electronLocale.startsWith("nn")) return "no"
  if (electronLocale.startsWith("pt")) return "br"
  if (electronLocale.startsWith("bs")) return "bs"
  return "en"
}

function getStoredLocale(): Locale {
  const store = getStore("opencode.global.dat")
  const stored = store.get("language") as unknown
  if (typeof stored === "string") {
    return parseLocale(stored) ?? detectLocale()
  }
  if (stored && typeof stored === "object") {
    const record = stored as Record<string, unknown>
    return parseLocale(record.locale) ?? detectLocale()
  }
  return detectLocale()
}

function build(locale: Locale): Dictionary {
  const base = i18n.flatten(en)
  if (locale === "en") return base
  if (locale === "zh") return { ...base, ...i18n.flatten(zh) }
  if (locale === "zht") return { ...base, ...i18n.flatten(zht) }
  if (locale === "de") return { ...base, ...i18n.flatten(de) }
  if (locale === "es") return { ...base, ...i18n.flatten(es) }
  if (locale === "fr") return { ...base, ...i18n.flatten(fr) }
  if (locale === "da") return { ...base, ...i18n.flatten(da) }
  if (locale === "ja") return { ...base, ...i18n.flatten(ja) }
  if (locale === "pl") return { ...base, ...i18n.flatten(pl) }
  if (locale === "ru") return { ...base, ...i18n.flatten(ru) }
  if (locale === "uk") return { ...base, ...i18n.flatten(uk) }
  if (locale === "ar") return { ...base, ...i18n.flatten(ar) }
  if (locale === "no") return { ...base, ...i18n.flatten(no) }
  if (locale === "br") return { ...base, ...i18n.flatten(br) }
  if (locale === "bs") return { ...base, ...i18n.flatten(bs) }
  return { ...base, ...i18n.flatten(ko) }
}

const locale = getStoredLocale()
const dict = build(locale)
const translate = i18n.translator(() => dict, i18n.resolveTemplate)

export function t(key: string, params?: Record<string, string | number>): string {
  return translate(key as keyof Dictionary, params)
}

export function getMenuLocale(): Locale {
  return locale
}
