import { describe, expect, test } from "bun:test"
import { initialRouteForArgs } from "../../../src/cli/cmd/tui/app"

describe("tui app", () => {
  test("does not use a placeholder session route while resolving --continue", () => {
    expect(initialRouteForArgs({ continue: true })).toBeUndefined()
  })

  test("does not use a placeholder session route while resolving --continue --fork", () => {
    expect(initialRouteForArgs({ continue: true, fork: true })).toBeUndefined()
  })

  test("uses explicit session route when not forking", () => {
    expect(initialRouteForArgs({ sessionID: "ses_existing" })).toEqual({
      type: "session",
      sessionID: "ses_existing",
    })
  })

  test("waits for fork result before routing an explicit session fork", () => {
    expect(initialRouteForArgs({ sessionID: "ses_existing", fork: true })).toBeUndefined()
  })
})
