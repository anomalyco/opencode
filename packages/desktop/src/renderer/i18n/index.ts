import * as i18n from "@solid-primitives/i18n"

import { dict as desktopEn } from "./en"
import { dict as desktopZh } from "./zh"
import { dict as desktopZht } from "./zht"
import { dict as desktopKo } from "./ko"
import { dict as desktopDe } from "./de"
import { dict as desktopEs } from "./es"
import { dict as desktopFr } from "./fr"
import { dict as desktopDa } from "./da"
import { dict as desktopJa } from "./ja"
import { dict as desktopPl } from "./pl"
import { dict as desktopRu } from "./ru"
import { dict as desktopUk } from "./uk"
import { dict as desktopAr } from "./ar"
import { dict as desktopNo } from "./no"
import { dict as desktopBr } from "./br"
import { dict as desktopBs } from "./bs"
import { dict as desktopTr } from "./tr"
import { dict as desktopHi } from "./hi"
import { dict as desktopNl } from "./nl"
import { dict as desktopId } from "./id"
import { dict as desktopVi } from "./vi"
import { dict as desktopIt } from "./it"
import { dict as desktopUr } from "./ur"
import { dict as desktopPa } from "./pa"
import { dict as desktopAz } from "./az"
import { dict as desktopFi } from "./fi"
import { dict as desktopSv } from "./sv"
import { dict as desktopTh } from "./th"

import { dict as appEn } from "../../../../app/src/i18n/en"
import { dict as appZh } from "../../../../app/src/i18n/zh"
import { dict as appZht } from "../../../../app/src/i18n/zht"
import { dict as appKo } from "../../../../app/src/i18n/ko"
import { dict as appDe } from "../../../../app/src/i18n/de"
import { dict as appEs } from "../../../../app/src/i18n/es"
import { dict as appFr } from "../../../../app/src/i18n/fr"
import { dict as appDa } from "../../../../app/src/i18n/da"
import { dict as appJa } from "../../../../app/src/i18n/ja"
import { dict as appPl } from "../../../../app/src/i18n/pl"
import { dict as appRu } from "../../../../app/src/i18n/ru"
import { dict as appUk } from "../../../../app/src/i18n/uk"
import { dict as appAr } from "../../../../app/src/i18n/ar"
import { dict as appNo } from "../../../../app/src/i18n/no"
import { dict as appBr } from "../../../../app/src/i18n/br"
import { dict as appBs } from "../../../../app/src/i18n/bs"
import { dict as appTr } from "../../../../app/src/i18n/tr"
import { dict as appHi } from "../../../../app/src/i18n/hi"
import { dict as appNl } from "../../../../app/src/i18n/nl"
import { dict as appId } from "../../../../app/src/i18n/id"
import { dict as appVi } from "../../../../app/src/i18n/vi"
import { dict as appIt } from "../../../../app/src/i18n/it"
import { dict as appUr } from "../../../../app/src/i18n/ur"
import { dict as appPa } from "../../../../app/src/i18n/pa"
import { dict as appAz } from "../../../../app/src/i18n/az"
import { dict as appFi } from "../../../../app/src/i18n/fi"
import { dict as appSv } from "../../../../app/src/i18n/sv"
import { dict as appTh } from "../../../../app/src/i18n/th"

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
  | "tr"
  | "hi"
  | "nl"
  | "id"
  | "vi"
  | "it"
  | "ur"
  | "pa"
  | "az"
  | "fi"
  | "sv"
  | "th"

type RawDictionary = typeof appEn & typeof desktopEn
type Dictionary = Record<keyof i18n.Flatten<RawDictionary>, string>

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
  "tr",
  "hi",
  "nl",
  "id",
  "vi",
  "it",
  "ur",
  "pa",
  "az",
  "fi",
  "sv",
  "th",
]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("en")) return "en"
    if (language.toLowerCase().startsWith("zh")) {
      if (
        language.toLowerCase().includes("hant") ||
        language.toLowerCase().includes("-tw") ||
        language.toLowerCase().includes("-hk") ||
        language.toLowerCase().includes("-mo")
      )
        return "zht"
      return "zh"
    }
    if (language.toLowerCase().startsWith("ko")) return "ko"
    if (language.toLowerCase().startsWith("de")) return "de"
    if (language.toLowerCase().startsWith("es")) return "es"
    if (language.toLowerCase().startsWith("fr")) return "fr"
    if (language.toLowerCase().startsWith("da")) return "da"
    if (language.toLowerCase().startsWith("ja")) return "ja"
    if (language.toLowerCase().startsWith("pl")) return "pl"
    if (language.toLowerCase().startsWith("ru")) return "ru"
    if (language.toLowerCase().startsWith("uk")) return "uk"
    if (language.toLowerCase().startsWith("ar")) return "ar"
    if (
      language.toLowerCase().startsWith("no") ||
      language.toLowerCase().startsWith("nb") ||
      language.toLowerCase().startsWith("nn")
    )
      return "no"
    if (language.toLowerCase().startsWith("pt")) return "br"
    if (language.toLowerCase().startsWith("bs")) return "bs"
    if (language.toLowerCase().startsWith("tr")) return "tr"
    if (language.toLowerCase().startsWith("hi")) return "hi"
    if (language.toLowerCase().startsWith("nl")) return "nl"
    if (language.toLowerCase().startsWith("id")) return "id"
    if (language.toLowerCase().startsWith("vi")) return "vi"
    if (language.toLowerCase().startsWith("it")) return "it"
    if (language.toLowerCase().startsWith("ur")) return "ur"
    if (
      language.toLowerCase().startsWith("pa") &&
      (language.toLowerCase().includes("arab") || language.toLowerCase().includes("-pk"))
    )
      return "pa"
    if (
      language.toLowerCase().startsWith("az") &&
      !language.toLowerCase().includes("arab") &&
      !language.toLowerCase().includes("cyrl")
    )
      return "az"
    if (language.toLowerCase().startsWith("fi")) return "fi"
    if (language.toLowerCase().startsWith("sv")) return "sv"
    if (language.toLowerCase().startsWith("th")) return "th"
  }

  return "en"
}

function parseLocale(value: unknown): Locale | null {
  if (!value) return null
  if (typeof value !== "string") return null
  if ((LOCALES as readonly string[]).includes(value)) return value as Locale
  return null
}

function parseRecord(value: unknown) {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseStored(value: unknown) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function pickLocale(value: unknown): Locale | null {
  const direct = parseLocale(value)
  if (direct) return direct

  const record = parseRecord(value)
  if (!record) return null

  return parseLocale(record.locale)
}

const base = i18n.flatten({ ...appEn, ...desktopEn })

function build(locale: Locale): Dictionary {
  if (locale === "en") return base
  if (locale === "zh") return { ...base, ...i18n.flatten(appZh), ...i18n.flatten(desktopZh) }
  if (locale === "zht") return { ...base, ...i18n.flatten(appZht), ...i18n.flatten(desktopZht) }
  if (locale === "de") return { ...base, ...i18n.flatten(appDe), ...i18n.flatten(desktopDe) }
  if (locale === "es") return { ...base, ...i18n.flatten(appEs), ...i18n.flatten(desktopEs) }
  if (locale === "fr") return { ...base, ...i18n.flatten(appFr), ...i18n.flatten(desktopFr) }
  if (locale === "da") return { ...base, ...i18n.flatten(appDa), ...i18n.flatten(desktopDa) }
  if (locale === "ja") return { ...base, ...i18n.flatten(appJa), ...i18n.flatten(desktopJa) }
  if (locale === "pl") return { ...base, ...i18n.flatten(appPl), ...i18n.flatten(desktopPl) }
  if (locale === "ru") return { ...base, ...i18n.flatten(appRu), ...i18n.flatten(desktopRu) }
  if (locale === "uk") return { ...base, ...i18n.flatten(appUk), ...i18n.flatten(desktopUk) }
  if (locale === "ar") return { ...base, ...i18n.flatten(appAr), ...i18n.flatten(desktopAr) }
  if (locale === "no") return { ...base, ...i18n.flatten(appNo), ...i18n.flatten(desktopNo) }
  if (locale === "br") return { ...base, ...i18n.flatten(appBr), ...i18n.flatten(desktopBr) }
  if (locale === "bs") return { ...base, ...i18n.flatten(appBs), ...i18n.flatten(desktopBs) }
  if (locale === "tr") return { ...base, ...i18n.flatten(appTr), ...i18n.flatten(desktopTr) }
  if (locale === "hi") return { ...base, ...i18n.flatten(appHi), ...i18n.flatten(desktopHi) }
  if (locale === "nl") return { ...base, ...i18n.flatten(appNl), ...i18n.flatten(desktopNl) }
  if (locale === "id") return { ...base, ...i18n.flatten(appId), ...i18n.flatten(desktopId) }
  if (locale === "vi") return { ...base, ...i18n.flatten(appVi), ...i18n.flatten(desktopVi) }
  if (locale === "it") return { ...base, ...i18n.flatten(appIt), ...i18n.flatten(desktopIt) }
  if (locale === "ur") return { ...base, ...i18n.flatten(appUr), ...i18n.flatten(desktopUr) }
  if (locale === "pa") return { ...base, ...i18n.flatten(appPa), ...i18n.flatten(desktopPa) }
  if (locale === "az") return { ...base, ...i18n.flatten(appAz), ...i18n.flatten(desktopAz) }
  if (locale === "fi") return { ...base, ...i18n.flatten(appFi), ...i18n.flatten(desktopFi) }
  if (locale === "sv") return { ...base, ...i18n.flatten(appSv), ...i18n.flatten(desktopSv) }
  if (locale === "th") return { ...base, ...i18n.flatten(appTh), ...i18n.flatten(desktopTh) }
  return { ...base, ...i18n.flatten(appKo), ...i18n.flatten(desktopKo) }
}

const state = {
  locale: detectLocale(),
  dict: base as Dictionary,
  init: undefined as Promise<Locale> | undefined,
}

state.dict = build(state.locale)

const translate = i18n.translator(() => state.dict, i18n.resolveTemplate)

export function t(key: keyof Dictionary, params?: Record<string, string | number>) {
  return translate(key, params)
}

export function initI18n(): Promise<Locale> {
  const cached = state.init
  if (cached) return cached

  const promise = (async () => {
    const raw = await window.api.storeGet("opencode.global.dat", "language").catch(() => null)
    const value = parseStored(raw)
    const next = pickLocale(value) ?? state.locale

    state.locale = next
    state.dict = build(next)
    return next
  })().catch(() => state.locale)

  state.init = promise
  return promise
}
