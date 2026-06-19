import { describe, test, expect } from "bun:test"
import { editorLanguageToShikiLang } from "./shiki-highlight"

describe("editorLanguageToShikiLang", () => {
  test("maps explicit languages", () => {
    expect(editorLanguageToShikiLang("typescript", undefined)).toBe("tsx")
    expect(editorLanguageToShikiLang("go", undefined)).toBe("go")
    expect(editorLanguageToShikiLang("python", undefined)).toBe("python")
    expect(editorLanguageToShikiLang("plaintext", undefined)).toBeUndefined()
  })

  test("explicit language wins over path", () => {
    expect(editorLanguageToShikiLang("go", "foo.ts")).toBe("go")
  })

  test("derives from path extension", () => {
    expect(editorLanguageToShikiLang(undefined, "a.ts")).toBe("typescript")
    expect(editorLanguageToShikiLang(undefined, "a.tsx")).toBe("tsx")
    expect(editorLanguageToShikiLang(undefined, "a.js")).toBe("javascript")
    expect(editorLanguageToShikiLang(undefined, "a.jsx")).toBe("jsx")
    expect(editorLanguageToShikiLang(undefined, "a.go")).toBe("go")
    expect(editorLanguageToShikiLang(undefined, "a.py")).toBe("python")
  })

  test("returns undefined for unknown / missing", () => {
    expect(editorLanguageToShikiLang(undefined, "a.md")).toBeUndefined()
    expect(editorLanguageToShikiLang(undefined, undefined)).toBeUndefined()
  })
})
