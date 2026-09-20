import { describe, expect, test } from "bun:test"
import {
  createDesktopNativeBundle,
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  DESKTOP_NATIVE_LABELS,
  DESKTOP_NATIVE_LOCALES,
  DESKTOP_NATIVE_LOCALE_TAGS,
  detectDesktopNativeLocale,
  DESKTOP_NATIVE_MAX_PAYLOAD_BYTES,
  formatDesktopNativeMessage,
  parseDesktopNativeBundle,
} from "./desktop-native"

describe("desktop native translations", () => {
  test("ships English only", () => {
    expect(DESKTOP_NATIVE_LOCALES).toEqual(["en"])
    expect(DESKTOP_NATIVE_LABELS.en).toBe("English")
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

describe("desktop native locale detection", () => {
  test("resolves every preference list to English", () => {
    expect(detectDesktopNativeLocale(["en-GB"])).toBe("en")
    expect(detectDesktopNativeLocale(["not_a_locale", "fr-FR"])).toBe("en")
    expect(detectDesktopNativeLocale(["zh-TW", "de-DE"])).toBe("en")
    expect(detectDesktopNativeLocale([])).toBe("en")
  })
})

describe("desktop native ICU data", () => {
  test("accepts every locale in standard Intl formatters", () => {
    for (const locale of DESKTOP_NATIVE_LOCALES) {
      const tag = DESKTOP_NATIVE_LOCALE_TAGS[locale]
      expect(() => new Intl.Locale(tag), `${locale} locale`).not.toThrow()
      expect(() => new Intl.NumberFormat(tag), `${locale} number`).not.toThrow()
      expect(() => new Intl.DateTimeFormat(tag), `${locale} date`).not.toThrow()
      expect(() => new Intl.PluralRules(tag), `${locale} plural`).not.toThrow()
      expect(() => new Intl.ListFormat(tag), `${locale} list`).not.toThrow()
      expect(() => new Intl.DisplayNames(tag, { type: "language" }), `${locale} names`).not.toThrow()
      expect(() => new Intl.Segmenter(tag), `${locale} segmenter`).not.toThrow()
    }
  })
})
