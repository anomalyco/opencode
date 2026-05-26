import { describe, expect, test } from "bun:test"
import {
  defaultDocsLocale,
  docsAlias,
  localeCookie,
  localeFromAcceptLanguage,
  localeFromCookie,
} from "./middleware-locale"

describe("docs locale middleware helpers", () => {
  test("redirects locale aliases to canonical docs paths", () => {
    expect(docsAlias("/docs/en/config/")).toEqual({ path: "/docs/config/", locale: "root" })
    expect(docsAlias("/docs/root/config/")).toEqual({ path: "/docs/config/", locale: "root" })
    expect(docsAlias("/docs/de/config/")).toBeNull()
  })

  test("persists English when visiting an unprefixed docs page", () => {
    expect(defaultDocsLocale("/docs/config/", null, "text/html")).toBe("root")
    expect(defaultDocsLocale("/docs/config/", null, "text/css")).toBeNull()
    expect(defaultDocsLocale("/docs/de/config/", null, "text/html")).toBeNull()
    expect(defaultDocsLocale("/blog", null, "text/html")).toBeNull()
  })

  test("persists English when switching the docs root from another locale", () => {
    expect(defaultDocsLocale("/docs/", "https://opencode.ai/docs/de/", "text/html")).toBe("root")
    expect(defaultDocsLocale("/docs/", "https://opencode.ai/docs/de/config/", "text/html")).toBe("root")
    expect(defaultDocsLocale("/docs/", "https://opencode.ai/docs/config/", "text/html")).toBeNull()
    expect(defaultDocsLocale("/docs/", "https://opencode.ai/docs/de/", "text/css")).toBeNull()
    expect(defaultDocsLocale("/docs/", null, "text/html")).toBeNull()
  })

  test("formats and reads locale cookies", () => {
    expect(localeCookie("root")).toContain("oc_locale=en")
    expect(localeFromCookie("theme=dark; oc_locale=de")).toBe("de")
    expect(localeFromCookie("oc_locale=en")).toBe("root")
  })

  test("uses accept-language quality order", () => {
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.8")).toBe("de")
    expect(localeFromAcceptLanguage("fr;q=0.4,en-US;q=0.8")).toBe("root")
  })
})
