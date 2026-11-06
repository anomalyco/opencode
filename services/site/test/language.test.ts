import { describe, expect, test } from "bun:test"
import { LOCALE_HEADER, localized, pageLocale, route } from "../src/lib/language"

describe("language.route", () => {
  test("keeps the changelog unprefixed for every locale", () => {
    expect(route("de", "/changelog")).toBe("/changelog")
    expect(route("zh", "/zh/changelog")).toBe("/changelog")
  })

  test("prefixes other marketing pages", () => {
    expect(route("de", "/download")).toBe("/de/download")
  })

  test("never prefixes the docs, the Console or the English-only pages", () => {
    for (const path of ["/v2/docs", "/v2/docs/agents/", "/v2", "/v1/docs/ide/", "/docs", "/console/go", "/font", "/changelog.xml"]) {
      expect(route("ja", path)).toBe(path)
      expect(route("ja", `/ja${path}`)).toBe(path)
      expect(localized(path)).toBe(false)
    }
    expect(route("ar", "/v2/docs?x=1#y")).toBe("/v2/docs?x=1#y")
    expect(localized("/v2docs")).toBe(true)
    expect(localized("/data")).toBe(true)
  })
})

describe("pageLocale", () => {
  const request = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://opencode.ai${path}`, { headers })
  const german = { "accept-language": "de-DE,de;q=0.9", cookie: "oc_locale=de" }

  test("ignores the browser language and cookie on unprefixed pages", () => {
    expect(pageLocale(request("/", german))).toBe("en")
    expect(pageLocale(request("/docs/agents/", german))).toBe("en")
  })

  test("uses the locale in the URL", () => {
    expect(pageLocale(request("/", { [LOCALE_HEADER]: "de" }))).toBe("de")
    expect(pageLocale(request("/docs/de/agents/"))).toBe("de")
  })
})
