import { describe, expect, test } from "bun:test"
import {
  isHomeSessionSearchResultCurrent,
  mergeHomeSessionSearchResults,
  splitHomeSessionSearchSnippet,
} from "./home-session-search"

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
