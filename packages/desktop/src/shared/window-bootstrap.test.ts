import { describe, expect, test } from "bun:test"
import { windowBootstrapArgument, windowBootstrapFromArguments } from "./window-bootstrap"

describe("window bootstrap", () => {
  test("round-trips through argv", () => {
    const bootstrap = { id: "win a/b ü", firstLaunchPending: false, defaultServerUrl: "http://127.0.0.1:1234" }
    expect(windowBootstrapFromArguments(["electron", windowBootstrapArgument(bootstrap)])).toEqual(bootstrap)
  })

  test("keeps unknown values absent", () => {
    expect(windowBootstrapFromArguments([windowBootstrapArgument({ id: "x" })])).toEqual({ id: "x" })
  })

  test("throws when the argument is missing", () => {
    expect(() => windowBootstrapFromArguments(["electron"])).toThrow("Window bootstrap argument not found")
  })
})
