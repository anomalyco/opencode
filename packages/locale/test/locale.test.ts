import { describe, expect, test } from "bun:test"
import {
  LOCALES,
  clearCookie,
  cookie,
  detectFromAcceptLanguage,
  detectFromLanguages,
  dir,
  fromPathname,
  label,
  localeFromCookieHeader,
  parseLocale,
  strip,
  tag,
} from "../src/index"

describe("locale metadata", () => {
  test("every locale has an endonym, a BCP 47 tag and a direction", () => {
    for (const locale of LOCALES) {
      expect(label(locale).length).toBeGreaterThan(0)
      expect(tag(locale).length).toBeGreaterThan(0)
      expect(["ltr", "rtl"]).toContain(dir(locale))
    }
    expect(label("de")).toBe("Deutsch")
    expect(tag("zh")).toBe("zh-Hans")
    expect(tag("zht")).toBe("zh-Hant")
    expect(tag("br")).toBe("pt-BR")
    expect(dir("ar")).toBe("rtl")
  })
})

describe("locale paths", () => {
  test("reads the locale from the first path segment", () => {
    expect(fromPathname("/de/desktop")).toBe("de")
    expect(fromPathname("zh/docs")).toBe("zh")
    expect(fromPathname("/docs")).toBeNull()
    expect(parseLocale("en")).toBe("en")
    expect(parseLocale("EN")).toBeNull()
    expect(parseLocale(undefined)).toBeNull()
  })

  test("strips the locale prefix and keeps the rest of the address", () => {
    expect(strip("/de")).toBe("/")
    expect(strip("/de/desktop?x=1")).toBe("/desktop?x=1")
    expect(strip("zht/docs/agents")).toBe("/docs/agents")
    expect(strip("/docs")).toBe("/docs")
  })
})

describe("locale cookies", () => {
  test("round-trips a locale through the shared cookie", () => {
    expect(localeFromCookieHeader(`a=1; ${cookie("de")}`)).toBe("de")
    expect(localeFromCookieHeader(`${cookie("zh")}`)).toBe("zh")
    expect(localeFromCookieHeader("other=1")).toBeNull()
    expect(localeFromCookieHeader(null)).toBeNull()
    expect(clearCookie()).toContain("Max-Age=0")
  })
})

describe("locale detection", () => {
  test("honours quality order and Chinese and Portuguese variants", () => {
    expect(detectFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr")
    expect(detectFromAcceptLanguage("de-DE;q=0.5,ja;q=0.9")).toBe("ja")
    expect(detectFromAcceptLanguage("zh-TW,zh;q=0.9")).toBe("zht")
    expect(detectFromAcceptLanguage("pt-PT")).toBe("br")
    expect(detectFromAcceptLanguage("nb-NO")).toBe("no")
    expect(detectFromAcceptLanguage("xx, *;q=0.1")).toBe("en")
    expect(detectFromLanguages(["xx", "ko-KR"])).toBe("ko")
    expect(detectFromLanguages(["xx"])).toBe("en")
  })
})
