import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"

const Model = ConfigProviderV1.Model
const Info = ConfigProviderV1.Info

describe("ConfigProviderV1.Model.fallback", () => {
  test("fallback is optional and undefined by default", () => {
    const result = Schema.decodeUnknownSync(Model)({})
    expect(result.fallback).toBeUndefined()
  })

  test("fallback accepts an array of strings", () => {
    const result = Schema.decodeUnknownSync(Model)({
      fallback: ["openai/gpt-5", "anthropic/claude-sonnet-4"],
    })
    expect(result.fallback).toEqual(["openai/gpt-5", "anthropic/claude-sonnet-4"])
  })

  test("fallback rejects non-string entries", () => {
    expect(() => Schema.decodeUnknownSync(Model)({ fallback: ["openai/gpt-5", 123] })).toThrow()
  })

  test("fallback rejects non-array value", () => {
    expect(() => Schema.decodeUnknownSync(Model)({ fallback: "openai/gpt-5" })).toThrow()
  })

  test("fallback is accessible through provider config", () => {
    const result = Schema.decodeUnknownSync(Info)({
      models: {
        "claude-sonnet-4": {
          fallback: ["openai/gpt-5"],
        },
      },
    })
    expect(result.models?.["claude-sonnet-4"]?.fallback).toEqual(["openai/gpt-5"])
  })
})
