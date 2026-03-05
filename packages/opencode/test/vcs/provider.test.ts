import { describe, test, expect } from "bun:test"
import type { WebhookEvent } from "../../src/vcs/provider"

describe("VCS Provider Interface", () => {
  test("WebhookEvent type has required fields", () => {
    const event: WebhookEvent = {
      type: "note",
      objectKind: "note",
      projectId: 61,
      mrIid: 123,
    }
    expect(event.type).toBe("note")
    expect(event.objectKind).toBe("note")
    expect(event.projectId).toBe(61)
    expect(event.mrIid).toBe(123)
  })
})
