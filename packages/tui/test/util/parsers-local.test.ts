// local-only: Die TUI darf Tree-sitter-Grammatiken nur aus lokalen Dateien laden.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { parsers } from "#tree-sitter-parsers"
import config from "../../src/parsers-config"
import { languages } from "../../script/parsers-languages.json"

const paths = (parser: (typeof parsers)[number]) => [parser.wasm, ...Object.values(parser.queries).flat()]

describe("parsers-local", () => {
  test("enthält keine Internet-URLs", () => {
    for (const parser of parsers) for (const file of paths(parser)) expect(file).not.toMatch(/^https?:\/\//)
  })

  test("alle Dateien liegen lokal vor", () => {
    for (const parser of parsers) for (const file of paths(parser)) expect(existsSync(file)).toBe(true)
  })

  // Schlägt nach einem Upstream-Merge fehl, wenn parsers-config.ts geändert wurde:
  // dann `node packages/tui/script/vendor-parsers.mjs` ausführen.
  test("entspricht parsers-config.ts", () => {
    const selected = config.parsers.filter((parser) => languages.includes(parser.filetype))
    expect(selected.map((parser) => parser.filetype).sort()).toEqual([...languages].sort())
    expect(parsers.map((parser) => parser.filetype)).toEqual(selected.map((parser) => parser.filetype))
    for (const [index, parser] of selected.entries()) {
      const local = parsers[index]!
      expect(Object.keys(local.queries).sort()).toEqual(Object.keys(parser.queries).sort())
      for (const [kind, urls] of Object.entries(parser.queries))
        expect((local.queries as Record<string, string[]>)[kind]).toHaveLength(urls.length)
    }
  })
})
