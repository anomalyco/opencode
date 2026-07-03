import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"

const previous = process.env.OPENCODE_CODE_MODE

afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_CODE_MODE
  else process.env.OPENCODE_CODE_MODE = previous
})

describe("Flag", () => {
  test("enables code mode by default and allows explicit disable", () => {
    delete process.env.OPENCODE_CODE_MODE
    expect(Flag.OPENCODE_CODE_MODE).toBe(true)

    process.env.OPENCODE_CODE_MODE = "false"
    expect(Flag.OPENCODE_CODE_MODE).toBe(false)

    process.env.OPENCODE_CODE_MODE = "true"
    expect(Flag.OPENCODE_CODE_MODE).toBe(true)
  })
})
