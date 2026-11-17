import { describe, expect, test } from "bun:test"
import { parseCommand, validateSettings } from "../../src/core/commands"

describe("parseCommand bare /rollover", () => {
  test("empty input → activate", () => {
    expect(parseCommand("")).toEqual({ kind: "activate" })
    expect(parseCommand("   ")).toEqual({ kind: "activate" })
  })
  test("explicit status stays status", () => {
    expect(parseCommand("status")).toEqual({ kind: "status" })
  })
})

describe("parseCommand --render", () => {
  test("k suffix", () => {
    expect(parseCommand("--render 10k")).toEqual({ kind: "settings", renderBudgetTokens: 10_000 })
  })
  test("m suffix and plain number", () => {
    expect(parseCommand("--render 1.5m")).toEqual({ kind: "settings", renderBudgetTokens: 1_500_000 })
    expect(parseCommand("--render 8000")).toEqual({ kind: "settings", renderBudgetTokens: 8000 })
  })
  test("combined with threshold and tail", () => {
    expect(parseCommand("100k -n 2 --render 10k")).toEqual({
      kind: "settings",
      thresholdTokens: 100_000,
      tailN: 2,
      renderBudgetTokens: 10_000,
    })
  })
  test("missing value → error", () => {
    expect(parseCommand("--render")).toEqual({ kind: "error", message: "Render budget must be at least 1k." })
  })
  test("invalid value → error", () => {
    expect(parseCommand("--render 5x").kind).toBe("error")
    expect(parseCommand("--render -n").kind).toBe("error")
  })
  test("repeated flag → error", () => {
    expect(parseCommand("--render 4k --render 8k").kind).toBe("error")
  })
  test("render only does not read as threshold", () => {
    const r = parseCommand("--render 10k")
    expect(r.kind).toBe("settings")
    if (r.kind === "settings") expect(r.thresholdTokens).toBeUndefined()
  })
})

describe("validateSettings --render", () => {
  const opts = { thresholdMinTokens: 20000, modelLimit: 1000000, tailMaxN: 20 }

  test("valid budget", () => {
    expect(validateSettings({ kind: "settings", renderBudgetTokens: 10_000 }, opts)).toEqual({
      ok: true,
      settings: { renderBudgetTokens: 10_000 },
    })
  })
  test("below 1k", () => {
    expect(validateSettings({ kind: "settings", renderBudgetTokens: 500 }, opts)).toEqual({
      ok: false,
      message: "Render budget must be at least 1k.",
    })
  })
  test("combined settings pass through", () => {
    expect(
      validateSettings({ kind: "settings", thresholdTokens: 150_000, tailN: 5, renderBudgetTokens: 8_000 }, opts),
    ).toEqual({ ok: true, settings: { thresholdTokens: 150_000, tailN: 5, renderBudgetTokens: 8_000 } })
  })
})
