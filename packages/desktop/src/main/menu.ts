import { BrowserWindow, Menu, shell } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { getStore } from "./store"

import { dict as desktopEn } from "../renderer/i18n/en"
import { dict as desktopZh } from "../renderer/i18n/zh"
import { dict as desktopZht } from "../renderer/i18n/zht"
import { dict as desktopKo } from "../renderer/i18n/ko"
import { dict as desktopDe } from "../renderer/i18n/de"
import { dict as desktopEs } from "../renderer/i18n/es"
import { dict as desktopFr } from "../renderer/i18n/fr"
import { dict as desktopDa } from "../renderer/i18n/da"
import { dict as desktopJa } from "../renderer/i18n/ja"
import { dict as desktopPl } from "../renderer/i18n/pl"
import { dict as desktopRu } from "../renderer/i18n/ru"
import { dict as desktopUk } from "../renderer/i18n/uk"
import { dict as desktopAr } from "../renderer/i18n/ar"
import { dict as desktopNo } from "../renderer/i18n/no"
import { dict as desktopBr } from "../renderer/i18n/br"
import { dict as desktopBs } from "../renderer/i18n/bs"

type MenuTranslations = Record<string, string>

const LOCALE_MAP: Record<string, string> = {
  en: "en",
  zh: "zh",
  zht: "zht",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  uk: "uk",
  ar: "ar",
  no: "no",
  br: "br",
  bs: "bs",
}

const LOCALE_DICTS: Record<string, Record<string, string>> = {
  en: desktopEn,
  zh: desktopZh,
  zht: desktopZht,
  ko: desktopKo,
  de: desktopDe,
  es: desktopEs,
  fr: desktopFr,
  da: desktopDa,
  ja: desktopJa,
  pl: desktopPl,
  ru: desktopRu,
  uk: desktopUk,
  ar: desktopAr,
  no: desktopNo,
  br: desktopBr,
  bs: desktopBs,
}

function detectLocale(): string {
  try {
    const store = getStore("opencode.global.dat")
    const raw = store.get("language", "")
    if (!raw) return "en"
    const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw) } catch { return raw } })() : raw
    const locale = typeof value === "object" && value !== null ? value.locale : value
    if (typeof locale === "string" && LOCALE_MAP[locale]) return locale
  } catch {}
  return "en"
}

function buildTranslations(locale: string): MenuTranslations {
  const base: MenuTranslations = {}
  for (const [key, value] of Object.entries(desktopEn)) {
    if (typeof value === "string") base[key] = value
  }
  const override = LOCALE_DICTS[locale]
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (typeof value === "string") base[key] = value
    }
  }
  return base
}

function resolveLabel(
  entry: { label?: string; labelKey?: string },
  translations: MenuTranslations,
): string {
  if (entry.labelKey && translations[entry.labelKey]) {
    return translations[entry.labelKey]
  }
  return entry.label || ""
}

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

  const locale = detectLocale()
  const translations = buildTranslations(locale)

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => {
    if (menu.role) return { role: nativeRole(menu.role) }
    return {
      label: resolveLabel(menu, translations),
      submenu: menu.items
        ?.filter((entry) => desktopMenuVisible(entry, "macos"))
        .map((entry) => nativeItem(entry, deps, translations)),
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(
  entry: DesktopMenuEntry,
  deps: Deps,
  translations: MenuTranslations,
): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role) return { role: nativeRole(entry.role) }

  const item: MenuItemConstructorOptions = {
    label: resolveLabel(entry, translations),
    accelerator: entry.accelerator?.macos,
    enabled: entry.enabled === "updater" ? UPDATER_ENABLED : undefined,
  }

  if (entry.command) {
    const command = entry.command
    item.click = () => deps.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    item.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        checkForUpdates: deps.checkForUpdates,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => shell.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}