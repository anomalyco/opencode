import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Exit } from "effect"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"

describe("RipgrepBinary.memoizeSuccess", () => {
  test("memoizes a successful resolution", async () => {
    let attempts = 0
    const program = Effect.gen(function* () {
      const memoized = yield* RipgrepBinary.memoizeSuccess(
        Effect.sync(() => {
          attempts++
          return "rg"
        }),
      )
      const first = yield* memoized
      const second = yield* memoized
      return [first, second]
    })

    expect(await Effect.runPromise(program)).toEqual(["rg", "rg"])
    expect(attempts).toBe(1)
  })

  test("retries a failed resolution instead of caching the failure", async () => {
    let attempts = 0
    const program = Effect.gen(function* () {
      const memoized = yield* RipgrepBinary.memoizeSuccess(
        Effect.sync(() => {
          attempts++
          if (attempts === 1) throw new Error("extraction failed")
          return "rg"
        }),
      )
      const first = yield* Effect.exit(memoized)
      const second = yield* memoized
      const third = yield* memoized
      return { first, second, third }
    })

    const { first, second, third } = await Effect.runPromise(program)
    expect(Exit.isFailure(first)).toBe(true)
    expect(second).toBe("rg")
    expect(third).toBe("rg")
    expect(attempts).toBe(2)
  })
})

describe("RipgrepBinary.windowsPowerShell5ModulePath", () => {
  test("points at the inbox Windows PowerShell 5.1 module directory", () => {
    expect(RipgrepBinary.windowsPowerShell5ModulePath("D:\\WinRoot")).toBe(
      path.join("D:\\WinRoot", "System32", "WindowsPowerShell", "v1.0", "Modules"),
    )
  })

  test("falls back to C:\\Windows when SystemRoot is unset", () => {
    expect(RipgrepBinary.windowsPowerShell5ModulePath(undefined)).toBe(
      path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"),
    )
  })
})
