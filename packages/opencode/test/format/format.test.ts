import { describe, test, expect } from "bun:test"
import * as Formatter from "../../src/format/formatter"

describe("Formatter", () => {
  describe("formatter definitions", () => {
    test("gofmt has correct configuration", () => {
      expect(Formatter.gofmt.name).toBe("gofmt")
      expect(Formatter.gofmt.extensions).toContain(".go")
      expect(Formatter.gofmt.command).toContain("gofmt")
      expect(Formatter.gofmt.command).toContain("$FILE")
    })

    test("prettier covers expected extensions", () => {
      const expected = [".js", ".jsx", ".ts", ".tsx", ".css", ".json", ".md"]
      for (const ext of expected) {
        expect(Formatter.prettier.extensions).toContain(ext)
      }
    })

    test("biome covers expected extensions", () => {
      const expected = [".js", ".jsx", ".ts", ".tsx", ".css", ".json"]
      for (const ext of expected) {
        expect(Formatter.biome.extensions).toContain(ext)
      }
    })

    test("ruff is configured for Python files", () => {
      expect(Formatter.ruff.name).toBe("ruff")
      expect(Formatter.ruff.extensions).toContain(".py")
      expect(Formatter.ruff.extensions).toContain(".pyi")
      expect(Formatter.ruff.command).toContain("ruff")
    })

    test("rustfmt is configured for Rust files", () => {
      expect(Formatter.rustfmt.name).toBe("rustfmt")
      expect(Formatter.rustfmt.extensions).toContain(".rs")
      expect(Formatter.rustfmt.command).toContain("rustfmt")
    })

    test("zig formatter handles .zig and .zon extensions", () => {
      expect(Formatter.zig.name).toBe("zig")
      expect(Formatter.zig.extensions).toEqual([".zig", ".zon"])
      expect(Formatter.zig.command).toEqual(["zig", "fmt", "$FILE"])
    })
  })

  describe("all formatters have required structure", () => {
    const allFormatters: Formatter.Info[] = [
      Formatter.gofmt,
      Formatter.mix,
      Formatter.prettier,
      Formatter.biome,
      Formatter.zig,
      Formatter.clang,
      Formatter.ktlint,
      Formatter.ruff,
      Formatter.rubocop,
      Formatter.standardrb,
      Formatter.dart,
      Formatter.terraform,
      Formatter.gleam,
      Formatter.shfmt,
      Formatter.nixfmt,
      Formatter.rustfmt,
      Formatter.pint,
      Formatter.ormolu,
      Formatter.latexindent,
      Formatter.ocamlformat,
      Formatter.htmlbeautifier,
      Formatter.rlang,
      Formatter.uvformat,
      Formatter.oxfmt,
    ]

    test("every formatter has a non-empty name", () => {
      for (const f of allFormatters) {
        expect(f.name.length).toBeGreaterThan(0)
      }
    })

    test("every formatter has at least one extension", () => {
      for (const f of allFormatters) {
        expect(f.extensions.length).toBeGreaterThan(0)
      }
    })

    test("every formatter command includes $FILE placeholder", () => {
      for (const f of allFormatters) {
        expect(f.command.some((arg) => arg.includes("$FILE"))).toBe(true)
      }
    })

    test("every formatter has an enabled() function", () => {
      for (const f of allFormatters) {
        expect(typeof f.enabled).toBe("function")
      }
    })

    test("all extensions start with a dot", () => {
      for (const f of allFormatters) {
        for (const ext of f.extensions) {
          expect(ext.startsWith(".")).toBe(true)
        }
      }
    })
  })

  describe("formatter-specific details", () => {
    test("clang-format supports C/C++ and Arduino extensions", () => {
      const expected = [".c", ".cpp", ".h", ".hpp", ".ino"]
      for (const ext of expected) {
        expect(Formatter.clang.extensions).toContain(ext)
      }
    })

    test("mix supports Elixir file extensions", () => {
      expect(Formatter.mix.extensions).toContain(".ex")
      expect(Formatter.mix.extensions).toContain(".exs")
      expect(Formatter.mix.extensions).toContain(".heex")
    })

    test("shfmt handles shell scripts", () => {
      expect(Formatter.shfmt.extensions).toContain(".sh")
      expect(Formatter.shfmt.extensions).toContain(".bash")
    })

    test("prettier has BUN_BE_BUN environment variable", () => {
      expect(Formatter.prettier.environment).toBeDefined()
      expect(Formatter.prettier.environment!["BUN_BE_BUN"]).toBe("1")
    })

    test("dart format command is correct", () => {
      expect(Formatter.dart.command).toEqual(["dart", "format", "$FILE"])
    })
  })
})
