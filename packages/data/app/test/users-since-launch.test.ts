import { describe, expect, test } from "bun:test"
import { usersSinceLaunch } from "../src/lib/page-data"

const weekly = [
  { week: "2026-11-16", users: 100 },
  { week: "2026-11-23", users: 80 },
]
const recency = {
  start: "2026-10-27",
  end: "2026-11-26",
  days: [
    { date: "2026-11-10", users: 9 },
    { date: "2026-11-16", users: 20 },
    { date: "2026-11-22", users: 30 },
    { date: "2026-11-25", users: 70 },
  ],
}

describe("usersSinceLaunch", () => {
  test("adds up users last active on or after the launch day", () => {
    expect(usersSinceLaunch({ weekly, recency }, "2026-11-16")).toBe(120)
  })

  test("adds up weekly users until the sync covers the launch day", () => {
    expect(usersSinceLaunch({ weekly, recency: null }, "2026-11-16")).toBe(180)
    expect(usersSinceLaunch({ weekly, recency }, "2026-11-26")).toBe(80)
  })
})
