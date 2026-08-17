import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { adaptServerEvent } from "./server-sdk"

describe("adaptServerEvent", () => {
  test("preserves current permission requests", () => {
    const current = {
      id: "evt_1",
      created: 1,
      type: "permission.asked",
      data: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    } as OpenCodeEvent

    expect(adaptServerEvent(current)).toMatchObject({
      id: "evt_1",
      type: "permission.asked",
      properties: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
      current,
    })
  })
})
