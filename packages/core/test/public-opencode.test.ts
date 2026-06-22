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
      yield* opencode.tools.register({
        public_tool: Tool.make({
          description: "Public tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.succeed({ ok: true }),
        }),
      })
    }),
  )

  it.effect("records model selection without resolving the Location catalog", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service
      const sessionID = Session.ID.make("ses_public_switch_deferred")
      const model = Schema.decodeUnknownSync(Model.Ref)({
        id: "missing",
        providerID: "missing",
        variant: "unknown",
      })
      yield* opencode.sessions.create({
        id: sessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/public-session-switch-model") }),
      })

      yield* opencode.sessions.switchModel({ sessionID, model })

      expect((yield* opencode.sessions.get(sessionID)).model).toEqual(model)
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
      if (error instanceof Session.NotFoundError) expect(error.sessionID).toBe(sessionID)
    }),
  )
})
