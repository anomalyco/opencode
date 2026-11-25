import { expect, test } from "bun:test"
import { INITIAL_SESSION_VIEWED_STATE, transitionSessionViewed } from "./viewed-machine"

test("a visit is viewed once, after focus and storage are ready", () => {
  const background = transitionSessionViewed(INITIAL_SESSION_VIEWED_STATE, {
    type: "changed",
    sessionID: "a",
    focused: false,
    ready: true,
  })

  expect(background).toEqual({ status: "waiting", sessionID: "a" })
  const loading = transitionSessionViewed(background, { type: "changed", sessionID: "a", focused: true, ready: false })

  expect(loading).toBe(background)
  const viewed = transitionSessionViewed(loading, { type: "changed", sessionID: "a", focused: true, ready: true })

  expect(viewed).toEqual({ status: "viewed", sessionID: "a" })
  expect(transitionSessionViewed(viewed, { type: "changed", sessionID: "a", focused: false, ready: true })).toBe(viewed)
  expect(transitionSessionViewed(viewed, { type: "changed", sessionID: "a", focused: true, ready: true })).toBe(viewed)
  const left = transitionSessionViewed(viewed, { type: "changed", sessionID: undefined, focused: true, ready: true })

  expect(left).toBe(INITIAL_SESSION_VIEWED_STATE)
  expect(transitionSessionViewed(left, { type: "changed", sessionID: "a", focused: true, ready: true })).not.toBe(
    viewed,
  )
})
