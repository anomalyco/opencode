import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

describe("local generated SDK contract", () => {
  test("exposes the local model context-size endpoint used by the TUI", () => {
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })

    expect(typeof client.local.scan).toBe("function")
    expect(typeof client.local.connect).toBe("function")
    expect(typeof client.local.disconnect).toBe("function")
    expect(typeof client.local.model.setCtxSize).toBe("function")
  })
})
