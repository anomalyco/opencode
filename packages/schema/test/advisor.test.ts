import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Advisor } from "../src/advisor.js"

describe("Advisor.State", () => {
  const decode = Schema.decodeUnknownSync(Advisor.State)

  test("decodes off without a model", () => {
    expect(decode({ mode: "off" })).toEqual({ mode: "off" })
  })

  test("decodes full and secure with a model", () => {
    expect(decode({ mode: "secure", model: { providerID: "a", id: "b" } })).toEqual({
      mode: "secure",
      model: { providerID: "a", id: "b" },
    })
  })

  test("rejects a non-off state without a model", () => {
    expect(() => decode({ mode: "full" })).toThrow()
  })
})
