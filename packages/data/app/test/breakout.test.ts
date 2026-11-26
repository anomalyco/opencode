import { describe, expect, test } from "bun:test"
import { selectBreakout } from "../src/lib/breakout"

const launch = (name: string, shares: number[], releaseDate = "2026-11-16") => ({
  name,
  releaseDate,
  daily: shares.map((share, index) => ({
    date: `2026-11-${16 + index}`,
    tokens: share * 100,
    share,
    rank: 2,
    users: index + 1,
  })),
})

describe("selectBreakout", () => {
  test("features the model with the highest peak share", () => {
    const quiet = launch("quiet", [0.02, 0.03, 0.04, 0.01])
    const smaller = launch("smaller", [0.12, 0.11, 0.01])
    const biggest = launch("biggest", [0.04, 0.11, 0.25, 0.2])

    const breakout = selectBreakout([quiet, smaller, biggest])

    expect(breakout?.model.name).toBe("biggest")
    expect(breakout?.alsoNew.map((model) => model.name)).toEqual(["quiet", "smaller"])
  })

  test("returns nothing when no model reaches 10% of a day", () => {
    expect(selectBreakout([launch("quiet", [0.02, 0.0999, 0.01])])).toBeUndefined()
  })

  test("ignores the partial current day", () => {
    expect(selectBreakout([launch("partial", [0.02, 0.05, 0.4])])).toBeUndefined()
    expect(selectBreakout([launch("day-one", [0.4])])).toBeUndefined()
  })

  test("keeps peak-day stats and the decline after share falls", () => {
    const breakout = selectBreakout([launch("fading", [0.05, 0.3, 0.2, 0.08, 0.01])])

    expect(breakout?.peak).toMatchObject({ date: "2026-11-17", share: 0.3, users: 2 })
    expect(breakout?.peakDay).toBe(2)
    expect(breakout?.days.map((day) => day.share)).toEqual([0.05, 0.3, 0.2, 0.08])
  })

  test("counts the peak day from the release date", () => {
    const breakout = selectBreakout([launch("late", [0.05, 0.3, 0.2], "2026-11-10")])

    expect(breakout?.peakDay).toBe(8)
  })

  test("leaves models with no usage on the last complete day out of also new", () => {
    const stopped = launch("stopped", [0.02, 0, 0.01])
    const active = launch("active", [0.01, 0.02, 0.01])

    const breakout = selectBreakout([launch("biggest", [0.2, 0.3, 0.1]), stopped, active])

    expect(breakout?.alsoNew.map((model) => model.name)).toEqual(["active"])
  })
})
