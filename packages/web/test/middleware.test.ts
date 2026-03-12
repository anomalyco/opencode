import { describe, expect, test } from "bun:test"
import {
  cookie,
  docsAlias,
  docsRedirect,
  docsRouteLocale,
  localeFromAcceptLanguage,
  localeFromCookie,
  redirect,
} from "../src/lib/docs-locale"

describe("docs middleware", () => {
  test("redirects bare docs aliases to explicit english paths", () => {
    expect(docsRedirect("/docs", "en")).toBe("/docs/en/")
    expect(docsRedirect("/docs/agents", "en")).toBe("/docs/en/agents")
  })

  test("redirects bare docs aliases to cookie locale paths", () => {
    expect(docsRedirect("/docs", "fr")).toBe("/docs/fr/")
    expect(docsRedirect("/docs/agents", "fr")).toBe("/docs/fr/agents")
  })

  test("keeps explicit locale routes authoritative", () => {
    expect(docsRedirect("/docs/en/agents", "fr")).toBeNull()
    expect(docsRedirect("/docs/fr/agents", "en")).toBeNull()
  })

  test("treats unknown locale-looking segments as bare docs aliases", () => {
    expect(docsRouteLocale("/docs/xx/agents")).toBe("en")
    expect(docsRedirect("/docs/xx/agents", "fr")).toBe("/docs/fr/xx/agents")
    expect(docsRedirect("/docs/xx/agents", "en")).toBe("/docs/en/xx/agents")
  })

  test("leaves unknown locale aliases alone", () => {
    expect(docsAlias("/docs/root/agents")).toBeNull()
    expect(docsAlias("/docs/root")).toBeNull()
  })

  test("parses locale from cookie and accept-language", () => {
    expect(localeFromCookie("foo=1; oc_locale=fr; bar=2")).toBe("fr")
    expect(localeFromCookie("oc_locale=en; foo=1; oc_locale=fr")).toBe("fr")
    expect(localeFromCookie('oc_locale="fr"; foo=1')).toBe("fr")
    expect(localeFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr")
    expect(localeFromAcceptLanguage(null)).toBe("en")
  })

  test("builds redirect responses with locale cookie", () => {
    const response = redirect(new URL("https://example.test/docs/agents"), "/docs/en/agents", "en")
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://example.test/docs/en/agents")
    expect(response.headers.get("set-cookie")).toBe(cookie("en"))
  })
})
