import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import { Duration } from "@opencode-ai/core/cron/duration"

describe("parseDuration", () => {
  const run = (input: string) => Effect.runSyncExit(Duration.parseDuration(input))

  it("5m → 300000", () => {
    expect(run("5m")).toEqual(Exit.succeed(300_000))
  })

  it("1h → 3600000", () => {
    expect(run("1h")).toEqual(Exit.succeed(3_600_000))
  })

  it("2h30m → 9000000", () => {
    expect(run("2h30m")).toEqual(Exit.succeed(9_000_000))
  })

  it("90s → 90000", () => {
    expect(run("90s")).toEqual(Exit.succeed(90_000))
  })

  it("30s → reject (below floor)", () => {
    const result = run("30s")
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause).toBeDefined()
    }
  })

  it("empty string → reject", () => {
    const result = run("")
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("abc → reject", () => {
    const result = run("abc")
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("5x → reject", () => {
    const result = run("5x")
    expect(Exit.isFailure(result)).toBe(true)
  })
})
