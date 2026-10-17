import { describe, expect, test } from "bun:test"
import { newSessionTarget } from "./new-session-target"

describe("titlebar new session target", () => {
  test("uses the project selected on the home screen", () => {
    expect(newSessionTarget({ projects: ["/alpha", "/beta"], selected: "/beta", last: "/alpha" })).toBe("/beta")
  })

  test("uses the last project when the selection matches nothing", () => {
    expect(newSessionTarget({ projects: ["/alpha", "/beta"], selected: "/missing", last: "/beta" })).toBe("/beta")
  })

  test("uses the first project when there is no selection or last project", () => {
    expect(newSessionTarget({ projects: ["/alpha", "/beta"] })).toBe("/alpha")
    expect(newSessionTarget({ projects: ["/alpha", "/beta"], selected: "/missing", last: "/missing" })).toBe("/alpha")
  })

  test("has no target before any project has been opened", () => {
    // The titlebar falls back to the server's own directory, which only the server can report.
    expect(newSessionTarget({ projects: [] })).toBeUndefined()
    expect(newSessionTarget({ projects: [], selected: "/missing" })).toBeUndefined()
  })
})
