import { describe, expect, test } from "bun:test"
import { resolveAppUserModelId, UNPACKAGED_APP_ID } from "./app-identity"

describe("desktop app identity", () => {
  test("keeps the packaged application identity", () => {
    expect(resolveAppUserModelId("ai.opencode.desktop.dev", true)).toBe("ai.opencode.desktop.dev")
    expect(resolveAppUserModelId("ai.opencode.desktop.beta", true)).toBe("ai.opencode.desktop.beta")
    expect(resolveAppUserModelId("ai.opencode.desktop", true)).toBe("ai.opencode.desktop")
  })

  test("keeps the unpackaged application separate from installed builds", () => {
    expect(resolveAppUserModelId("ai.opencode.desktop.dev", false)).toBe(UNPACKAGED_APP_ID)
    expect(UNPACKAGED_APP_ID).not.toBe("ai.opencode.desktop.dev")
  })
})
