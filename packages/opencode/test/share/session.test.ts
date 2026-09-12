import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { testEffect } from "../lib/effect"

const session = {
  id: SessionID.make("ses_ephemeral"),
  parentID: undefined,
  ephemeral: true,
} as Session.Info

const env = LayerNode.compile(SessionShare.node, [
  [Config.node, Layer.mock(Config.Service, { get: () => Effect.succeed({ share: "auto" }) })],
  [
    Session.node,
    Layer.mock(Session.Service, {
      create: () => Effect.succeed(session),
      get: () => Effect.succeed(session),
    }),
  ],
  [ShareNext.node, Layer.mock(ShareNext.Service, { create: () => Effect.die("unexpected share") })],
  [RuntimeFlags.node, RuntimeFlags.layer({ autoShare: true })],
])
const it = testEffect(env)

describe("SessionShare", () => {
  it.effect("does not auto-share ephemeral sessions", () =>
    Effect.gen(function* () {
      const result = yield* (yield* SessionShare.Service).create({ ephemeral: true })

      expect(result).toBe(session)
    }),
  )

  it.effect("refuses to share ephemeral sessions", () =>
    Effect.gen(function* () {
      const svc = yield* SessionShare.Service
      const exit = yield* svc.share(session.id).pipe(Effect.exit)

      expect(Exit.isSuccess(exit)).toBe(false)
      if (Exit.isSuccess(exit)) return
      expect(String(exit.cause)).toContain("Ephemeral sessions cannot be shared")
    }),
  )
})
