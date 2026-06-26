import { describe, expect, test } from "bun:test"
import { findReferenceAlias, findReferencePath, referenceMentionPath } from "../../src/component/prompt/autocomplete-reference"

const references = [
  { name: "home", path: "/home/jescudero" },
  { name: "hidden", path: "/tmp/hidden", hidden: true },
]

describe("prompt reference autocomplete", () => {
  test("keeps bare aliases as alias matches", () => {
    expect(findReferenceAlias("home", references)?.path).toBe("/home/jescudero")
    expect(findReferencePath("home", references)).toBeUndefined()
  })

  test("searches inside visible references after the alias slash", () => {
    expect(findReferencePath("home/projects", references)).toEqual({
      reference: references[0],
      query: "projects",
    })
  })

  test("does not autocomplete hidden references", () => {
    expect(findReferenceAlias("hidden", references)).toBeUndefined()
    expect(findReferencePath("hidden/file", references)).toBeUndefined()
  })

  test("preserves alias paths for inserted file mentions", () => {
    expect(referenceMentionPath("home", "docs/readme.md")).toBe("home/docs/readme.md")
    expect(referenceMentionPath("home", "docs\\readme.md")).toBe("home/docs/readme.md")
  })
})
