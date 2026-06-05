import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode, Session } from "@opencode-ai/core/public"
import { testEffect } from "./lib/effect"

const it = testEffect(OpenCode.layer)

describe("public native OpenCode API", () => {
  it.effect("exposes only the intentional Session capabilities", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service

      expect(Object.keys(opencode.sessions).sort()).toEqual([
        "context",
        "create",
        "events",
        "get",
        "list",
        "message",
        "messages",
        "prompt",
      ])
      expect(Session.ID.create()).toStartWith("ses_")
      expect(Session.MessageID.create()).toStartWith("msg_")
      expect(yield* opencode.sessions.list()).toBeArray()
    }),
  )
})
