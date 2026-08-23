import { describe, expect, test } from "bun:test"
import { windowIDArgument, windowIDFromArguments } from "./window-bootstrap"

describe("window bootstrap", () => {
  test("round-trips the window ID through renderer arguments", () => {
    const id = "window/id with spaces"
    expect(windowIDFromArguments(["electron", windowIDArgument(id)])).toBe(id)
  })

  test("requires a window ID argument", () => {
    expect(() => windowIDFromArguments(["electron"])).toThrow("Window ID argument not found")
  })
})
