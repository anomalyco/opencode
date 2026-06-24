import { describe, expect, test } from "bun:test"
import { parseReferenceSearch } from "../../src/component/prompt/autocomplete"

describe("autocomplete references", () => {
  const references = [
    { name: "docs", path: "D:/docs" },
    { name: "hidden", path: "D:/hidden", hidden: true },
  ]

  test("only treats alias paths as reference file searches", () => {
    expect(parseReferenceSearch("docs", references)).toBeUndefined()
    expect(parseReferenceSearch("missing/file", references)).toBeUndefined()
    expect(parseReferenceSearch("hidden/file", references)).toBeUndefined()
  })

  test("resolves file searches under a visible reference alias", () => {
    expect(parseReferenceSearch("docs/", references)).toEqual({
      reference: references[0],
      query: "",
      prefix: "docs/",
    })

    expect(parseReferenceSearch("docs/guides/install", references)).toEqual({
      reference: references[0],
      query: "guides/install",
      prefix: "docs/",
    })
  })
})
