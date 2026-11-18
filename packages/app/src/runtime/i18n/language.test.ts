import { describe, expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH, DESKTOP_NATIVE_LOCALES } from "./desktop-native"
import en from "./en"
import { localizedListParts, richTemplateParts } from "./language"
import { dict as enUi } from "../../../../ui/src/i18n/en"

type Dict = Record<string, string>

const appEnglish = en as Dict
const uiEnglish = enUi as Dict

// Native menu and dialog copy is owned by desktop-native and reaches Electron through
// createDesktopNativeBundle, which falls back to DESKTOP_NATIVE_ENGLISH per key. Those
// keys are excluded here so this test covers app-owned copy only.
const nativeKeys = new Set(Object.keys(DESKTOP_NATIVE_ENGLISH))
const appKeys = Object.keys(appEnglish).filter((key) => !nativeKeys.has(key))

// English keys that landed before their translations. A new English key must be
// translated in every locale or added here with a reason; entries are removed as
// translations arrive.
const PENDING_TRANSLATION = new Set([
  "dialog.directory.breadcrumbs",
  "dialog.directory.moreProjects",
  "project.browse.back",
  "project.browse.history",
  "project.browse.newSession",
  "project.browse.partial",
  "project.browse.title",
  "project.start.reconnect",
  "provider.connect.form.browserFailed",
  "provider.connect.oauth.browserFailed",
  "session.new.project.other.search",
  "session.new.workspace.useMainCheckout",
  "settings.helpFeedback",
  "settings.plugins.check",
  "settings.plugins.checking",
  "settings.plugins.update",
  "settings.plugins.update.label",
  "settings.plugins.updating",
  "settings.providers.account.remove.description",
  "settings.providers.account.remove.finalDescription",
  "settings.providers.account.remove.title",
  "settings.providers.disconnect.consoleDescription.one",
  "settings.providers.disconnect.consoleDescription.other",
  "settings.providers.disconnect.description",
  "settings.providers.disconnect.title",
  "settings.timeline.row.foldUserMessages.description",
  "workspace.delete.confirm",
])

const placeholders = (value: string) =>
  [...value.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort().join(",")

async function dictionaries() {
  return Promise.all(
    DESKTOP_NATIVE_LOCALES.filter((locale) => locale !== "en").map(async (locale) => ({
      locale,
      app: (await import(`./${locale}`)).dict as Dict,
      ui: (await import(`../../../../ui/src/i18n/${locale}`)).dict as Dict,
    })),
  )
}

describe("rich translations", () => {
  test("lets the translated phrase position a rich slot", () => {
    const names = { type: "names" }
    expect(richTemplateParts("Written by {{names}}", { names })).toEqual(["Written by ", names])
    expect(richTemplateParts("{{names}} tarafından yazıldı", { names })).toEqual([names, " tarafından yazıldı"])
  })

  test("keeps list elements intact while localizing punctuation", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check is that no element was stringified
    expect(localizedListParts("en", items).filter((part) => typeof part !== "string")).toEqual(items)
  })
})

describe("dictionaries", () => {
  test("are flat string maps in every locale", async () => {
    const modules = await Promise.all(
      DESKTOP_NATIVE_LOCALES.flatMap((locale) => [
        import(`./${locale}`),
        import(`../../../../ui/src/i18n/${locale}`),
      ]),
    )

    const nested = modules.flatMap((module) =>
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check is that no value is nested
      Object.entries<unknown>(module.dict).filter(([, value]) => typeof value !== "string"),
    )

    expect(nested).toEqual([])
  })

  test("have every app-owned English key translated or explicitly pending", async () => {
    const missing = (await dictionaries()).flatMap(({ locale, app }) =>
      appKeys
        .filter((key) => !(key in app) && !PENDING_TRANSLATION.has(key))
        .map((key) => `${locale}: ${key}`),
    )

    expect(missing).toEqual([])
  })

  test("have every UI English key translated", async () => {
    const missing = (await dictionaries()).flatMap(({ locale, ui }) =>
      Object.keys(uiEnglish)
        .filter((key) => !(key in ui))
        .map((key) => `${locale}: ${key}`),
    )

    expect(missing).toEqual([])
  })

  test("keep the English placeholders in every translation", async () => {
    const broken = (await dictionaries()).flatMap(({ locale, app, ui }) => {
      const result: string[] = []
      for (const [source, dictionary, surface] of [
        [appEnglish, app, "app"],
        [uiEnglish, ui, "ui"],
      ] as const) {
        for (const [key, value] of Object.entries(dictionary)) {
          if (!(key in source)) continue
          if (placeholders(value) !== placeholders(source[key])) result.push(`${locale}/${surface}: ${key}`)
        }
      }
      return result
    })

    expect(broken).toEqual([])
  })
})
