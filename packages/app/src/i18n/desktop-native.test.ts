import { describe, expect, test } from "bun:test"
import {
  createDesktopNativeBundle,
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  DESKTOP_NATIVE_LABELS,
  DESKTOP_NATIVE_LOCALES,
  DESKTOP_NATIVE_MAX_PAYLOAD_BYTES,
  formatDesktopNativeMessage,
  parseDesktopNativeBundle,
} from "./desktop-native"

describe("desktop native translations", () => {
  test("uses native language names independent of the active locale", () => {
    expect(DESKTOP_NATIVE_LOCALES.map((locale) => DESKTOP_NATIVE_LABELS[locale])).toEqual([
      "English",
      "简体中文",
      "繁體中文",
      "한국어",
      "Deutsch",
      "Español",
      "Français",
      "Dansk",
      "日本語",
      "Polski",
      "Русский",
      "Українська",
      "Bosanski",
      "العربية",
      "Norsk",
      "Português (Brasil)",
      "ไทย",
      "Türkçe",
      "हिन्दी",
      "Nederlands",
      "Bahasa Indonesia",
      "Tiếng Việt",
      "Italiano",
      "اردو",
      "پنجابی",
      "Azərbaycanca",
      "Suomi",
      "Svenska",
    ])
  })

  test("accepts the exact typed bundle", () => {
    const bundle = createDesktopNativeBundle("en", (key) => DESKTOP_NATIVE_ENGLISH[key])
    expect(parseDesktopNativeBundle(bundle)).toEqual(bundle)
  })

  test("rejects unsupported locales and mismatched key sets", () => {
    const bundle = createDesktopNativeBundle("en", (key) => DESKTOP_NATIVE_ENGLISH[key])
    expect(parseDesktopNativeBundle({ ...bundle, locale: "en-US" })).toBeUndefined()
    expect(
      parseDesktopNativeBundle({
        ...bundle,
        messages: Object.fromEntries(DESKTOP_NATIVE_KEYS.slice(1).map((key) => [key, bundle.messages[key]])),
      }),
    ).toBeUndefined()
    expect(parseDesktopNativeBundle({ ...bundle, messages: { ...bundle.messages, extra: "no" } })).toBeUndefined()
    expect(
      parseDesktopNativeBundle({
        ...bundle,
        messages: { ...bundle.messages, [DESKTOP_NATIVE_KEYS[0]]: "x".repeat(DESKTOP_NATIVE_MAX_PAYLOAD_BYTES) },
      }),
    ).toBeUndefined()
    expect(
      parseDesktopNativeBundle({ ...bundle, messages: { ...bundle.messages, [DESKTOP_NATIVE_KEYS[0]]: 1 } }),
    ).toBeUndefined()
  })

  test("interpolates native templates without changing unknown placeholders", () => {
    expect(formatDesktopNativeMessage("{{known}} {{unknown}}", { known: "yes" })).toBe("yes {{unknown}}")
  })
})
