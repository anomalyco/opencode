import { expect, test } from "bun:test"
import { newSessionRoute } from "../../src/context/route"

test("new session preserves a provisional session location before hydration", () => {
  const provisional = { directory: "/tmp/other-project", workspaceID: "ws_other" }

  expect(newSessionRoute({ type: "session", sessionID: "ses_other", location: provisional })).toEqual({
    type: "home",
    location: provisional,
  })
})

test("new session prefers the hydrated session location", () => {
  const hydrated = { directory: "/tmp/moved-project" }

  expect(
    newSessionRoute(
      { type: "session", sessionID: "ses_other", location: { directory: "/tmp/other-project" } },
      hydrated,
    ),
  ).toEqual({ type: "home", location: hydrated })
})
