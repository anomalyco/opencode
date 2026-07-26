import { describe, expect, test } from "bun:test"
import {
  findHomeSessionSearchResult,
  isHomeSessionSearchResultCurrent,
  mergeHomeSessionSearchResults,
  settledHomeSessionSearchResult,
  splitHomeSessionSearchSnippet,
} from "./home-session-search"

describe("settledHomeSessionSearchResult", () => {
  test("does not read query data before the first search settles", () => {
    let reads = 0
    const result = { sessions: [], snippets: {} }

    expect(
      settledHomeSessionSearchResult({
        isSuccess: false,
        get data() {
          reads++
          return result
        },
      }),
    ).toBeUndefined()
    expect(reads).toBe(0)

    expect(
      settledHomeSessionSearchResult({
        isSuccess: true,
        get data() {
          reads++
          return result
        },
      }),
    ).toBe(result)
    expect(reads).toBe(1)
  })
})

describe("isHomeSessionSearchResultCurrent", () => {
  const result = { query: "spectral cache", server: "local", scope: "/project" }

  test("accepts only the resolved query in the same server scope", () => {
    expect(
      isHomeSessionSearchResultCurrent(result, { query: "spectral cache", server: "local", scope: "/project" }),
    ).toBe(true)
    expect(
      isHomeSessionSearchResultCurrent(result, { query: "spectral caches", server: "local", scope: "/project" }),
    ).toBe(false)
    expect(
      isHomeSessionSearchResultCurrent(result, { query: "spectral cache", server: "remote", scope: "/project" }),
    ).toBe(false)
    expect(
      isHomeSessionSearchResultCurrent(result, { query: "spectral cache", server: "local", scope: "/other" }),
    ).toBe(false)
  })
})

describe("mergeHomeSessionSearchResults", () => {
  test("keeps settled server results while the next local filter is empty", () => {
    const settled = [{ id: "content-match", title: "Cache investigation" }]

    expect(mergeHomeSessionSearchResults({ local: [], remote: settled, key: (item) => item.id })).toEqual(settled)
  })

  test("prefers server records carrying search context", () => {
    expect(
      mergeHomeSessionSearchResults({
        local: [{ id: "content-match", snippet: undefined }],
        remote: [{ id: "content-match", snippet: "spectral cache" }],
        key: (item) => item.id,
      }),
    ).toEqual([{ id: "content-match", snippet: "spectral cache" }])
  })
})

describe("findHomeSessionSearchResult", () => {
  test("matches arbitrary directory characters without parsing them as a selector", () => {
    const root = document.createElement("div")
    const expected = document.createElement("button")
    const key = String.raw`/project/with "quotes"] and \slashes:ses_match`
    expected.dataset.key = key
    root.append(document.createElement("button"), expected)

    expect(findHomeSessionSearchResult(root, key)).toBe(expected)
  })
})

describe("splitHomeSessionSearchSnippet", () => {
  test("preserves the original casing while marking the matching phrase", () => {
    expect(splitHomeSessionSearchSnippet("Inspect the Spectral Cache invalidation path", "spectral cache")).toEqual([
      { text: "Inspect the ", match: false },
      { text: "Spectral Cache", match: true },
      { text: " invalidation path", match: false },
    ])
  })

  test("keeps an unmatched snippet as plain context", () => {
    expect(splitHomeSessionSearchSnippet("Database migration settings", "spectral cache")).toEqual([
      { text: "Database migration settings", match: false },
    ])
  })
})
