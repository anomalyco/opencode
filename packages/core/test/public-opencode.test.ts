import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AbsolutePath, Location, Model, OpenCode, Session, Tool } from "@opencode-ai/core/public"
import { testEffect } from "./lib/effect"

const it = testEffect(OpenCode.layer)

describe("public native OpenCode API", () => {
  it.effect("exposes only the intentional Session capabilities", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service

      expect(Object.keys(opencode).sort()).toEqual(["sessions", "tools"])

      expect(Object.keys(opencode.sessions).sort()).toEqual([
        "context",
        "create",
        "events",
        "get",
        "interrupt",
        "list",
        "message",
        "messages",
        "prompt",
        "switchModel",
      ])
      expect(Session.ID.create()).toStartWith("ses_")
      expect(Session.MessageID.create()).toStartWith("msg_")
      expect(yield* opencode.sessions.list()).toBeArray()
      yield* opencode.tools.attach({
        public_tool: Tool.make({
          description: "Public tool",
          parameters: Schema.Struct({}),
          success: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.succeed({ ok: true }),
        }),
      })
    }),
  )

  it.effect("switches the exact Session to the exact model through the durable facade", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service
      const targetID = Session.ID.make("ses_public_switch_target")
      const otherID = Session.ID.make("ses_public_switch_other")
      const model = Schema.decodeUnknownSync(Model.Ref)({
        id: "claude-sonnet-4-5",
        providerID: "anthropic",
        variant: "high",
      })
      const location = Location.Ref.make({ directory: AbsolutePath.make("/public-session-switch-model") })
      yield* opencode.sessions.create({ id: targetID, location })
      yield* opencode.sessions.create({ id: otherID, location })

      yield* opencode.sessions.switchModel({ sessionID: targetID, model })

      expect((yield* opencode.sessions.get(targetID)).model).toEqual(model)
      expect((yield* opencode.sessions.get(otherID)).model).toBeUndefined()
    }),
  )

  it.effect("preserves the typed not-found error for a missing Session", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service
      const sessionID = Session.ID.make("ses_public_switch_missing")
      const error = yield* opencode.sessions
        .switchModel({
          sessionID,
          model: Schema.decodeUnknownSync(Model.Ref)({ id: "claude-sonnet-4-5", providerID: "anthropic" }),
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Session.NotFoundError)
      expect(error.sessionID).toBe(sessionID)
    }),
  )
})
