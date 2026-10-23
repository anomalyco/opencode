import type { SimpleHighlight } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import {
  OUTPUT_LANGUAGE_LIMIT,
  detectOutputLanguage,
  outputLanguage,
  previewHighlights,
} from "../../src/util/tool-output"

const json = '{"p": "/console/invite", "els": ["- textbox \\"user@example.com\\" [ref=e174]"]}'

describe("outputLanguage", () => {
  test("leaves output plain when nothing is configured", () => {
    expect(outputLanguage(undefined, "browser", json)).toBeUndefined()
    expect(outputLanguage({}, "browser", json)).toBeUndefined()
  })

  test("takes the exact tool name over any glob", () => {
    const settings = { "*": "auto", "browser*": "yaml", browser: "json" }
    expect(outputLanguage(settings, "browser", "x")).toBe("json")
  })

  test("takes the glob with the most literal characters", () => {
    const settings = { "*": "markdown", "github_*": "json", "github_create_*": "yaml", "gh?b": "toml" }
    expect(outputLanguage(settings, "github_create_issue", "x")).toBe("yaml")
    expect(outputLanguage(settings, "github_list", "x")).toBe("json")
    expect(outputLanguage(settings, "gh_b", "x")).toBe("toml")
    expect(outputLanguage(settings, "context7_query", "x")).toBe("markdown")
  })

  test("treats regex characters in a name literally", () => {
    expect(outputLanguage({ "a.b*": "json" }, "axb1", "x")).toBeUndefined()
    expect(outputLanguage({ "a.b*": "json" }, "a.b1", "x")).toBe("json")
  })

  test("none switches a tool off under a broader glob", () => {
    expect(outputLanguage({ "*": "json", todo: "none" }, "todo", json)).toBeUndefined()
  })

  test("auto colors only output recognized as JSON", () => {
    expect(outputLanguage({ "*": "auto" }, "browser", json)).toBe("json")
    expect(outputLanguage({ "*": "auto" }, "browser", "Navigated to https://x")).toBeUndefined()
  })

  test("never colors output past the size limit", () => {
    const big = `[${'"x",'.repeat(OUTPUT_LANGUAGE_LIMIT / 4)}"x"]`
    expect(outputLanguage({ browser: "json" }, "browser", big)).toBeUndefined()
  })
})

describe("detectOutputLanguage", () => {
  test("recognizes objects and arrays that parse", () => {
    expect(detectOutputLanguage(`  ${json}\n`)).toBe("json")
    expect(detectOutputLanguage("[1, 2, 3]")).toBe("json")
  })

  test("rejects text that only looks like JSON", () => {
    expect(detectOutputLanguage("{not json}")).toBeUndefined()
    expect(detectOutputLanguage("[ref=e174] clicked")).toBeUndefined()
    expect(detectOutputLanguage('{"a": 1} trailing')).toBeUndefined()
    expect(detectOutputLanguage('"a string"')).toBeUndefined()
    expect(detectOutputLanguage("42")).toBeUndefined()
    expect(detectOutputLanguage("")).toBeUndefined()
  })

  test("answers the same content again from its cache", () => {
    const text = `{"n": ${Date.now()}}`
    expect(detectOutputLanguage(text)).toBe("json")
    expect(detectOutputLanguage(text)).toBe("json")
  })
})

describe("previewHighlights", () => {
  const output = '{\n  "p": "/x",\n  "els": [1, 2]\n}'
  const highlights: SimpleHighlight[] = [
    [4, 7, "property"],
    [9, 13, "string"],
    [17, 22, "property"],
    [25, 26, "number"],
  ]

  test("keeps every highlight when the whole output is shown", () => {
    expect(previewHighlights(output, output, highlights)).toBe(highlights)
  })

  test("keeps the highlights inside a collapsed preview and cuts the one it splits", () => {
    const shown = output.slice(0, 20) + "…"
    expect(previewHighlights(shown, output, highlights)).toEqual([
      [4, 7, "property"],
      [9, 13, "string"],
      [17, 20, "property"],
    ])
  })

  test("gives a line-collapsed preview the colors of the lines it keeps", () => {
    const shown = output.split("\n").slice(0, 2).join("\n") + "\n…"
    expect(previewHighlights(shown, output, highlights)).toEqual([
      [4, 7, "property"],
      [9, 13, "string"],
    ])
  })
})
