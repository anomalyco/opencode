import { describe, expect, test } from "bun:test"

/**
 * CWE-79: CSS Injection via theme ID
 * File: packages/ui/src/theme/loader.ts
 *
 * buildThemeCss interpolates themeId into a CSS selector: html[data-theme="${themeId}"]
 * A malicious theme loaded via loadThemeFromUrl could inject arbitrary CSS
 * by including "] or } characters in the theme ID.
 */

function sanitizeThemeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

describe("CWE-79: CSS injection via theme ID in loader.ts", () => {
  test("should strip quotes from theme ID", () => {
    expect(sanitizeThemeId('my-theme"]{} body{display:none}')).toBe("my-themebodydisplaynone")
  })

  test("should strip closing brackets", () => {
    expect(sanitizeThemeId("theme]{color:red}")).toBe("themecolorred")
  })

  test("should strip angle brackets", () => {
    expect(sanitizeThemeId("theme<script>")).toBe("themescript")
  })

  test("should allow valid theme IDs", () => {
    expect(sanitizeThemeId("oc-2")).toBe("oc-2")
    expect(sanitizeThemeId("my_custom-theme-1")).toBe("my_custom-theme-1")
    expect(sanitizeThemeId("DarkMode")).toBe("DarkMode")
  })

  test("should strip spaces and special chars", () => {
    expect(sanitizeThemeId("my theme; color: red")).toBe("mythemecolorred")
  })
})
