import { describe, expect, test } from "bun:test"
import type { ParsedKey } from "@opentui/core"
import { probePaste } from "../../../../src/cli/cmd/tui/component/prompt/paste-key"

const key = (input: Partial<ParsedKey>) =>
  ({
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    super: false,
    ...input,
  }) as ParsedKey

describe("paste key", () => {
  test("matches ctrl+v on any platform", () => {
    expect(probePaste(key({ name: "v", ctrl: true }), "linux")).toBe(true)
  })

  test("matches cmd+v on macos via super", () => {
    expect(probePaste(key({ name: "v", super: true }), "darwin")).toBe(true)
  })

  test("matches cmd+v on macos via meta", () => {
    expect(probePaste(key({ name: "v", meta: true }), "darwin")).toBe(true)
  })

  test("does not match cmd+v on non-macos", () => {
    expect(probePaste(key({ name: "v", super: true }), "linux")).toBe(false)
  })

  test("does not match other keys", () => {
    expect(probePaste(key({ name: "c", ctrl: true }), "darwin")).toBe(false)
  })
})
