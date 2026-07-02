import { describe, expect, test } from "bun:test"
import { hasConnectedProvider } from "../../src/util/connected-provider"

describe("hasConnectedProvider", () => {
  test("is false without integration credentials", () => {
    expect(hasConnectedProvider([])).toBe(false)
    expect(hasConnectedProvider([{ connections: [] }])).toBe(false)
  })

  test("is true after any provider integration is connected", () => {
    expect(hasConnectedProvider([{ connections: [{ type: "credential", id: "cred_1", label: "Work" }] }])).toBe(true)
    expect(hasConnectedProvider([{ connections: [{ type: "env", name: "OPENAI_API_KEY" }] }])).toBe(true)
  })
})
