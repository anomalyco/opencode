import * as i18n from "@solid-primitives/i18n"
import { Store } from "@tauri-apps/plugin-store"

import { dict as desktopEn } from "./en"

import { dict as appEn } from "../../../app/src/i18n/en"
import { dict as appZh } from "../../../app/src/i18n/zh"
import { dict as appZht } from "../../../app/src/i18n/zht"
import { dict as appKo } from "../../../app/src/i18n/ko"
import { dict as appDe } from "../../../app/src/i18n/de"
import { dict as appEs } from "../../../app/src/i18n/es"
import { dict as appFr } from "../../../app/src/i18n/fr"
import { dict as appDa } from "../../../app/src/i18n/da"
import { dict as appJa } from "../../../app/src/i18n/ja"
import { dict as appPl } from "../../../app/src/i18n/pl"
import { dict as appRu } from "../../../app/src/i18n/ru"
import { dict as appAr } from "../../../app/src/i18n/ar"
import { dict as appNo } from "../../../app/src/i18n/no"
import { dict as appBr } from "../../../app/src/i18n/br"

export type Locale = "en" | "zh" | "zht" | "ko" | "de" | "es" | "fr" | "da" | "ja" | "pl" | "ru" | "ar" | "no" | "br"

type RawDictionary = typeof appEn & typeof desktopEn
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = ["en", "zh", "zht", "ko", "de", "es", "fr", "da", "ja", "pl", "ru", "ar", "no", "br"]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) {
      if (language.toLowerCase().includes("hant")) return "zht"
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
    if (language.toLowerCase().startsWith("ar")) return "ar"
    if (
      language.toLowerCase().startsWith("no") ||
      language.toLowerCase().startsWith("nb") ||
      language.toLowerCase().startsWith("nn")
    )
      return "no"
    if (language.toLowerCase().startsWith("pt")) return "br"
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
  if (locale === "zh") return { ...base, ...i18n.flatten(appZh) }
  if (locale === "zht") return { ...base, ...i18n.flatten(appZht) }
  if (locale === "de") return { ...base, ...i18n.flatten(appDe) }
  if (locale === "es") return { ...base, ...i18n.flatten(appEs) }
  if (locale === "fr") return { ...base, ...i18n.flatten(appFr) }
  if (locale === "da") return { ...base, ...i18n.flatten(appDa) }
  if (locale === "ja") return { ...base, ...i18n.flatten(appJa) }
  if (locale === "pl") return { ...base, ...i18n.flatten(appPl) }
  if (locale === "ru") return { ...base, ...i18n.flatten(appRu) }
  if (locale === "ar") return { ...base, ...i18n.flatten(appAr) }
  if (locale === "no") return { ...base, ...i18n.flatten(appNo) }
  if (locale === "br") return { ...base, ...i18n.flatten(appBr) }
  return { ...base, ...i18n.flatten(appKo) }
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
    const store = await Store.load("opencode.global.dat").catch(() => null)
    if (!store) return state.locale

    const raw = await store.get("language").catch(() => null)
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    const next = pickLocale(value) ?? state.locale

    state.locale = next
    state.dict = build(next)
    return next
  })().catch(() => state.locale)

  state.init = promise
  return promise
}
