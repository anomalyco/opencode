import { describe, expect, test } from "bun:test"
import { parseFrecency } from "../../src/prompt/frecency"

describe("prompt frecency", () => {
  test("skips malformed entries and retains valid neighbors", () => {
    const first = { path: "/first.ts", frequency: 1, lastOpen: 1 }
    const second = { path: "/second.ts", frequency: 2, lastOpen: 2 }
    const input = [
      JSON.stringify(first),
      "null",
      JSON.stringify({ path: "/missing-frequency.ts", lastOpen: 3 }),
      JSON.stringify({ path: "/invalid-last-open.ts", frequency: 1, lastOpen: null }),
      JSON.stringify(second),
    ].join("\n")

    expect(parseFrecency(input)).toEqual([second, first])
  })
})
