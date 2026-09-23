import { describe, expect, test } from "bun:test"
import { FALLBACK_OTHER_CONTRIBUTORS, otherContributorCount } from "./contributors"

describe("otherContributorCount", () => {
  test("subtracts the contributors named in the colophon", () => {
    expect(
      otherContributorCount(
        '<https://api.github.com/repositories/975734319/contributors?anon=1&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/975734319/contributors?anon=1&per_page=1&page=1004>; rel="last"',
      ),
    ).toBe(988)
  })

  test("falls back when pagination metadata is unavailable", () => {
    expect(otherContributorCount(null)).toBe(FALLBACK_OTHER_CONTRIBUTORS)
    expect(otherContributorCount("invalid")).toBe(FALLBACK_OTHER_CONTRIBUTORS)
  })
})
