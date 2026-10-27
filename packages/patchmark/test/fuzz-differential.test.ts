import { describe, expect, test } from "bun:test"
import { generate, mutate, normalizeHtml, patchmark, referenceCore, referenceGfm, rng } from "./fuzz"
import { isKnownGfmDivergence } from "./fuzz-known"

describe("differential fuzzing against commonmark 0.31.2 and micromark-gfm", () => {
  test("zero core CommonMark diffs across 5,000 seeded generated + spec-mutated cases", () => {
    const r = rng(0xc0ffeed0)

    for (let i = 0; i < 5_000; i++) {
      const md = i % 2 === 0 ? generate(r, false) : mutate(r)
      const got = patchmark(md, false)
      const want = referenceCore(md)

      if (got !== want) {
        expect({ case: i, md, got }).toEqual({ case: i, md, got: want })
      }
    }
  })

  test("zero unexplained GFM diffs across 2,000 seeded generated + spec-mutated cases", () => {
    const r = rng(0xdecafbad)

    for (let i = 0; i < 2_000; i++) {
      const md = i % 2 === 0 ? generate(r, true) : mutate(r)
      const got = normalizeHtml(patchmark(md, true))
      const want = normalizeHtml(referenceGfm(md))

      if (got !== want && !isKnownGfmDivergence(md, got, want)) {
        expect({ case: i, md, got }).toEqual({ case: i, md, got: want })
      }
    }
  })
})
