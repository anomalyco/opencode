import { describe, expect, test } from "bun:test"
import bundledGrammarAssets from "../script/bundled-grammars.json"
import { bundledGrammars } from "../script/bundled-grammars"

describe("bundled tree-sitter grammars", () => {
  test("embeds every grammar under unique basenames", () => {
    const basenames = Object.values(bundledGrammars).flatMap((g) => [
      g.wasm.file,
      ...Object.values(g.queries).flatMap((assets) => assets.map((a) => a.file)),
    ])
    expect(basenames.length).toBeGreaterThan(0)
    expect(new Set(basenames).size).toBe(basenames.length)
  })

  test("pins a sha256 for every asset", () => {
    for (const grammar of Object.values(bundledGrammars)) {
      expect(grammar.wasm.sha256).toMatch(/^[a-f0-9]{64}$/)
      for (const assets of Object.values(grammar.queries)) {
        for (const asset of assets) expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
      }
    }
  })

  test("groups assets identically to nix/opencode.nix", () => {
    // Mirror of lib.groupBy (asset: lib.head (lib.splitString "-" asset.file))
    // so the Nix per-grammar derivations cannot drift from the TS grouping.
    const nixGroups: Record<string, string[]> = {}
    for (const asset of bundledGrammarAssets) {
      const dash = asset.file.indexOf("-")
      expect(dash).toBeGreaterThan(0)
      ;(nixGroups[asset.file.slice(0, dash)] ??= []).push(asset.file)
    }
    for (const [lang, files] of Object.entries(nixGroups)) {
      const grammar = bundledGrammars[lang]
      expect(grammar, `no TS grammar grouped under ${lang}`).toBeDefined()
      const tsFiles = [
        grammar!.wasm.file,
        ...Object.values(grammar!.queries).flatMap((assets) => assets.map((a) => a.file)),
      ]
      expect(tsFiles.sort()).toEqual(files.sort())
    }
  })
})
