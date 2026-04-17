import { describe, expect, test } from "bun:test"
import { Npm } from "../src/npm"

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@opencode/acme")).toBe("@opencode/acme")
    expect(Npm.sanitize("@opencode/acme@1.0.0")).toBe("@opencode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  // Regression: bun's import resolver treats `foo:/bar` as a URL scheme and bypasses
  // registered plugins (e.g. @opentui/solid's JSX transform). Cached plugin paths that
  // include URLs (release-asset installs get sanitized via Npm.add, but the spec key
  // itself flows through sanitize and must never produce a `:` in the output path).
  test("strips `:` on all platforms to avoid URL-scheme confusion", () => {
    const spec = "https://github.com/owner/repo/releases/download/v1/pkg.tgz"
    expect(Npm.sanitize(spec)).not.toContain(":")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/opencode/acme.git"
    expect(Npm.sanitize(spec)).toBe("acme@git+https_//github.com/opencode/acme.git")
  })
})
