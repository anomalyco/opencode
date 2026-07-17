import { expect, test } from "bun:test"
import { interestEqual, subscribeInput } from "../../src/context/event-interest"

test("subscribeInput omits empty sessions and maps sessions to session", () => {
  expect(subscribeInput(undefined)).toBeUndefined()
  expect(subscribeInput({})).toEqual({})
  expect(subscribeInput({ location: { directory: "/tmp/project" }, sessions: [] })).toEqual({
    location: { directory: "/tmp/project" },
  })
  expect(
    subscribeInput({
      location: { directory: "/tmp/project", workspace: "ws_1" },
      sessions: ["ses_a", "ses_b"],
    }),
  ).toEqual({
    location: { directory: "/tmp/project", workspace: "ws_1" },
    session: ["ses_a", "ses_b"],
  })
})

test("interestEqual compares location and session sets", () => {
  const base = { location: { directory: "/tmp/project" }, sessions: ["ses_a"] }
  expect(interestEqual(base, base)).toBe(true)
  expect(interestEqual(base, { location: { directory: "/tmp/project" }, sessions: ["ses_a"] })).toBe(true)
  expect(interestEqual(base, { location: { directory: "/tmp/other" }, sessions: ["ses_a"] })).toBe(false)
  expect(
    interestEqual(base, { location: { directory: "/tmp/project", workspace: "ws_1" }, sessions: ["ses_a"] }),
  ).toBe(false)
  expect(interestEqual(base, { location: { directory: "/tmp/project" }, sessions: ["ses_b"] })).toBe(false)
  expect(interestEqual({ location: { directory: "/tmp/project" } }, { location: { directory: "/tmp/project" } })).toBe(
    true,
  )
  expect(interestEqual(undefined, undefined)).toBe(true)
  expect(interestEqual(base, undefined)).toBe(false)
})
