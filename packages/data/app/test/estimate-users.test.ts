import { describe, expect, test } from "bun:test"
import { estimateUsersSinceLaunch } from "../src/lib/estimate-users"

// Hy4 flash on opencode.ai/data at 2026-11-26T04:11Z: Nov 26 is about four hours in.
const hy4 = {
  daily: [13604, 32502, 35265, 40074, 41138, 38409, 39135, 47596, 50547, 51027, 16864].map((users, index) => ({
    date: `2026-11-${16 + index}`,
    users,
  })),
  weekly: [
    { week: "2026-11-16", users: 101769 },
    { week: "2026-11-23", users: 83743 },
  ],
  firstSeen: "2026-11-16",
  launch: "2026-11-16",
}

describe("estimateUsersSinceLaunch", () => {
  test("counts returning users once across weeks", () => {
    const users = estimateUsersSinceLaunch(hy4)

    expect(users).toBeGreaterThan(135_000)
    expect(users).toBeLessThan(147_000)
  })

  test("takes a launch week's count as is", () => {
    expect(estimateUsersSinceLaunch({ ...hy4, daily: hy4.daily.slice(0, 7), weekly: hy4.weekly.slice(0, 1) })).toBe(
      101_769,
    )
  })

  test("leaves out early access before the launch day", () => {
    const users = estimateUsersSinceLaunch({ ...hy4, launch: "2026-11-18" })

    expect(users).toBeLessThan(estimateUsersSinceLaunch(hy4))
    expect(users).toBeGreaterThanOrEqual(83_743)
  })

  test("stays between the largest week and the sum of weeks", () => {
    const users = estimateUsersSinceLaunch({
      ...hy4,
      daily: hy4.daily.map((day) => ({ ...day, users: 10 })),
    })

    expect(users).toBeGreaterThanOrEqual(101_769)
    expect(users).toBeLessThanOrEqual(185_512)
  })

  test("adds up the weeks when no week lines up with the days", () => {
    expect(estimateUsersSinceLaunch({ ...hy4, daily: [] })).toBe(185_512)
    expect(estimateUsersSinceLaunch({ ...hy4, firstSeen: "2026-11-01", daily: hy4.daily.slice(2) })).not.toBeNaN()
  })
})
