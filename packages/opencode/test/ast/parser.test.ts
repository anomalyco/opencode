import { expect, describe, it } from "bun:test"
import type { SupportedLanguage } from "../../src/ast/languages"
import { detectLanguage } from "../../src/ast/parser"
import { LANGUAGE_MAP } from "../../src/ast/languages"

describe("detectLanguage", () => {
  const cases: readonly [string, SupportedLanguage | null][] = [
    ["foo.ts", "typescript"],
    ["foo.tsx", "tsx"],
    ["foo.js", "javascript"],
    ["foo.jsx", "javascript"],
    ["foo.mjs", "javascript"],
    ["foo.py", "python"],
    ["foo.sh", "bash"],
    ["foo.go", "go"],
    ["foo.rs", "rust"],
    ["foo.rb", "ruby"],
    ["foo.java", "java"],
    ["foo.c", "c"],
    ["foo.cpp", "cpp"],
    ["foo.cxx", "cpp"],
    ["foo.css", "css"],
    ["foo.html", "html"],
    ["foo.htm", "html"],
    ["foo.json", "json"],
    ["foo.yml", "yaml"],
    ["foo.yaml", "yaml"],
    ["foo.toml", "toml"],
    ["foo.txt", null],
    ["foo", null],
    [".bashrc", null],
  ]

  for (const [file, expected] of cases) {
    it(`detects ${file} as ${expected ?? "null"}`, () => {
      expect(detectLanguage(file)).toBe(expected)
    })
  }
})

describe("LANGUAGE_MAP", () => {
  it("every key has a truthy WASM path", () => {
    for (const lang of Object.keys(LANGUAGE_MAP)) {
      expect(LANGUAGE_MAP[lang as keyof typeof LANGUAGE_MAP]).toBeTruthy()
    }
  })
})

describe("Parser WASM loading", () => {
  it("loads TypeScript grammar", async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init()
    const grammar = await Language.load(LANGUAGE_MAP.typescript)
    expect(grammar).toBeTruthy()
  }, 10000)

  it("loads Go grammar", async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init()
    const grammar = await Language.load(LANGUAGE_MAP.go)
    expect(grammar).toBeTruthy()
  }, 10000)

  it("loads Rust grammar", async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init()
    const grammar = await Language.load(LANGUAGE_MAP.rust)
    expect(grammar).toBeTruthy()
  }, 10000)

  it("loads Python grammar", async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init()
    const grammar = await Language.load(LANGUAGE_MAP.python)
    expect(grammar).toBeTruthy()
  }, 10000)
})
