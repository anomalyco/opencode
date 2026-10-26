import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { getTreeSitterClient } from "@opentui/core"
import { filetype } from "../../src/util/filetype"
import { Languages } from "../../src/util/languages"

// OpenTUI ships these grammars locally, so the parsers load without the network.
const assets = path.join(path.dirname(fileURLToPath(import.meta.resolve("@opentui/core"))), "assets")
const zig = path.join(assets, "zig")
const language = (id: string, extensions: string[]) => ({
  id,
  extensions,
  wasm: path.join(zig, "tree-sitter-zig.wasm"),
  highlights: [path.join(zig, "highlights.scm")],
})

afterEach(() => {
  Languages.set("plugins", [])
  Languages.set("config", [])
})

test("maps registered extensions before the built-in table, with cli.json overriding plugins", () => {
  expect(filetype("Main.elm")).toBeUndefined()

  Languages.set("plugins", [language("elm", [".elm"]), language("plugin-haskell", [".hs"])])
  expect(filetype("Main.elm")).toBe("elm")
  expect(filetype("Main.hs")).toBe("plugin-haskell")

  Languages.set("config", [language("config-elm", [".elm"])])
  expect(filetype("Main.elm")).toBe("config-elm")

  Languages.set("plugins", [])
  Languages.set("config", [])
  expect(filetype("Main.elm")).toBeUndefined()
  expect(filetype("Main.hs")).toBe("haskell")
})

test("highlights a registered language through the shared parser worker", async () => {
  Languages.set("config", [language("testlang", [".tl"])])
  expect(filetype("answer.tl")).toBe("testlang")

  const result = await getTreeSitterClient().highlightOnce("const answer: u32 = 42;", "testlang")
  expect(result.error).toBeUndefined()
  expect(result.highlights?.length).toBeGreaterThan(0)
})

test("resolves a registered alias to its language", async () => {
  Languages.set("config", [{ ...language("testlang-alias", [".tla"]), aliases: ["testlang"] }])

  const result = await getTreeSitterClient().highlightOnce("const answer: u32 = 42;", "testlang")
  expect(result.error).toBeUndefined()
  expect(result.highlights?.length).toBeGreaterThan(0)
})

test("resolves sources into locations the parser worker can load", () => {
  const directory = path.resolve("config")
  const queries = path.resolve("queries", "highlights.scm")
  expect(
    Languages.resolve(
      {
        id: "elm",
        aliases: ["elm-lang"],
        wasm: "./elm/tree-sitter-elm.wasm",
        highlights: ["https://example.com/highlights.scm", pathToFileURL(queries).href],
        injections: [queries],
        injectionMapping: { infoStringMap: { elm: "elm" } },
      },
      directory,
    ),
  ).toEqual({
    id: "elm",
    aliases: ["elm-lang"],
    wasm: path.join(directory, "elm", "tree-sitter-elm.wasm"),
    highlights: ["https://example.com/highlights.scm", queries],
    injections: [queries],
    injectionMapping: { infoStringMap: { elm: "elm" } },
  })
  expect(() => Languages.resolve({ id: "elm", wasm: "./tree-sitter-elm.wasm", highlights: [queries] })).toThrow(
    "Language elm: ./tree-sitter-elm.wasm must be a URL or an absolute path",
  )
})

test("keeps a runtime registration's own filetype instead of the built-in typescript alias", () => {
  Languages.set("config", [
    {
      id: "javascript",
      extensions: [".js"],
      wasm: path.join(assets, "javascript", "tree-sitter-javascript.wasm"),
      highlights: [path.join(assets, "javascript", "highlights.scm")],
    },
  ])
  expect(filetype("script.js")).toBe("javascript")
})
