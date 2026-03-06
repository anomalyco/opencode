import { describe, expect, test } from "bun:test"
import { docs, localeFromCookieHeader } from "../src/lib/language"

describe("docs", () => {
  test("redirects bare docs paths to the requested locale", () => {
    expect(docs("en", "/docs")).toBe("/docs/en/")
    expect(docs("fr", "/docs/agents")).toBe("/docs/fr/agents")
  })

  test("keeps explicit docs locales authoritative", () => {
    expect(docs("en", "/docs/fr/agents")).toBe("/docs/fr/agents")
    expect(docs("fr", "/docs/en/agents")).toBe("/docs/en/agents")
  })

  test("normalizes the legacy root docs alias", () => {
    expect(docs("fr", "/docs/root/agents")).toBe("/docs/en/agents")
  })

  test("parses locale cookie from the latest value", () => {
    expect(localeFromCookieHeader("oc_locale=en; foo=1; oc_locale=fr")).toBe("fr")
    expect(localeFromCookieHeader('foo=1; oc_locale="fr"')).toBe("fr")
  })
})
