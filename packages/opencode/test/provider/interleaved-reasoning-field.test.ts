import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"

// vLLM reads fed-back reasoning from `reasoning`, not `reasoning_content`, so the enum must allow it.
const decodeField = (field: unknown) =>
  Schema.decodeUnknownSync(ConfigProviderV1.Info)({ models: { m: { interleaved: { field } } } })

describe("interleaved.field enum (#19988)", () => {
  test("accepts 'reasoning'", () => {
    expect(() => decodeField("reasoning")).not.toThrow()
  })

  test("still accepts the pre-existing values", () => {
    expect(() => decodeField("reasoning_content")).not.toThrow()
    expect(() => decodeField("reasoning_details")).not.toThrow()
  })

  test("rejects anything else", () => {
    expect(() => decodeField("reasoning_lol")).toThrow()
    expect(() => decodeField("thinking")).toThrow()
    expect(() => decodeField("")).toThrow()
  })
})
