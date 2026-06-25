import { describe, expect, test } from "bun:test"
import type { ReferenceInfo } from "@opencode-ai/sdk/v2"
import {
  findExactReferenceAlias,
  resolveReferenceFileSearch,
  withReferenceFilePrefix,
} from "../../../src/component/prompt/autocomplete-reference"

function reference(name: string, referencePath: string, hidden = false): ReferenceInfo {
  return {
    name,
    path: referencePath,
    ...(hidden ? { hidden } : {}),
    source: {
      type: "local",
      path: referencePath,
      ...(hidden ? { hidden } : {}),
    },
  }
}

describe("autocomplete reference search", () => {
  const references = [reference("docs", "D:\\docs"), reference("hidden", "D:\\hidden", true)]

  test("uses the reference directory when the query contains an alias slash", () => {
    expect(resolveReferenceFileSearch("docs/guide", references)).toEqual({
      reference: references[0],
      query: "guide",
      prefix: "docs/",
      location: {
        directory: "D:\\docs",
      },
    })
  })

  test("keeps the slash query empty when browsing a reference root", () => {
    expect(resolveReferenceFileSearch("docs/", references)?.query).toBe("")
  })

  test("does not treat alias slash queries as exact reference aliases", () => {
    expect(findExactReferenceAlias("docs/guide", references)).toBeUndefined()
    expect(findExactReferenceAlias("docs", references)).toBe(references[0])
  })

  test("prefixes reference file results with the alias", () => {
    expect(withReferenceFilePrefix("docs/", "nested\\guide.md")).toBe("docs/nested/guide.md")
  })

  test("ignores hidden references", () => {
    expect(resolveReferenceFileSearch("hidden/secret", references)).toBeUndefined()
    expect(findExactReferenceAlias("hidden", references)).toBeUndefined()
  })
})
