import { describe, expect, test } from "bun:test"
import { isAdverse, scrubMeta } from "../../src/decision/receipt"

describe("decision/receipt", () => {
  test("isAdverse matches reject/offer/hire case-insensitively", () => {
    expect(isAdverse("reject")).toBe(true)
    expect(isAdverse("OFFER")).toBe(true)
    expect(isAdverse("Hire")).toBe(true)
    expect(isAdverse("note")).toBe(false)
  })

  test("scrubMeta strips secret keys and nested secrets", () => {
    const scrubbed = scrubMeta({
      note: "ok",
      api_key: "secret",
      Authorization: "Bearer x",
      nested: { password: "p", keep: 1 },
      token: "t",
    })
    expect(scrubbed).toEqual({
      note: "ok",
      nested: { keep: 1 },
    })
  })

  test("scrubMeta returns undefined for empty or non-object", () => {
    expect(scrubMeta(undefined)).toBeUndefined()
    expect(scrubMeta("x")).toBeUndefined()
    expect(scrubMeta({ apiKey: "x" })).toBeUndefined()
  })
})
