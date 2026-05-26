import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { PatentSearch } from "../../src/patent/search"
import { withTmpdirInstance } from "../fixture/fixture"

describe("PatentSearch", () => {
  test("isAvailable returns false by default", async () => {
    await Effect.gen(function* () {
      const svc = yield* PatentSearch.Service
      const available = yield* svc.isAvailable()
      expect(available).toBe(false)
    })
      .pipe(Effect.provide(PatentSearch.defaultLayer))
      .pipe(withTmpdirInstance())
      .pipe(Effect.scoped)
      .pipe(Effect.runPromise)
  })

  test("search returns error when not available", async () => {
    await Effect.gen(function* () {
      const svc = yield* PatentSearch.Service
      const result = yield* svc.search({ keyword: "test" }).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    })
      .pipe(Effect.provide(PatentSearch.defaultLayer))
      .pipe(withTmpdirInstance())
      .pipe(Effect.scoped)
      .pipe(Effect.runPromise)
  })
})