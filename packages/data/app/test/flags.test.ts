import { afterEach, describe, expect, test } from "bun:test"
import { enabledDataFlags } from "../src/lib/flags"

const saved = { flags: process.env.DATA_FLAGS, stage: process.env.STAGE }

afterEach(() => {
  if (saved.flags === undefined) delete process.env.DATA_FLAGS
  else process.env.DATA_FLAGS = saved.flags
  if (saved.stage === undefined) delete process.env.STAGE
  else process.env.STAGE = saved.stage
})

describe("data flags", () => {
  test("a local build turns every flag on", () => {
    delete process.env.STAGE
    delete process.env.DATA_FLAGS
    expect(enabledDataFlags()).toContain("share")
  })

  test("DATA_FLAGS turns a flag off by name", () => {
    delete process.env.STAGE
    process.env.DATA_FLAGS = "-share"
    expect(enabledDataFlags()).not.toContain("share")
  })
})
