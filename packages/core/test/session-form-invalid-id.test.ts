import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Instance } from "@opencode-ai/core/instance/service"
import { Project } from "@opencode-ai/core/project"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionEnvironment } from "@opencode-ai/core/session/environment"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { offlineModels } from "./fixture/models"

const transport = Layer.effect(
  SessionModelTransport.Service,
  Effect.gen(function* () {
    return SessionModelTransport.Service.of({
      bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
      close: () => Effect.void,
      closeAll: Effect.void,
    })
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionEnvironment.node,
      Session.node,
      Instance.node,
      LocationServiceMap.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionModelTransport.node.replace(transport),
      offlineModels,
    ],
  ),
)

describe("Session.form invalid session IDs", () => {
  it.effect("fails malformed IDs with InvalidSessionIDError instead of dying", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const error = yield* sessions.form.list({ sessionID: "not-a-session-id" }).pipe(Effect.flip)
      expect(error).toEqual(new Session.InvalidSessionIDError({ sessionID: "not-a-session-id" }))
      expect(error.message).toContain("not-a-session-id")
    }),
  )

  it.effect("fails well-formed unknown IDs with NotFoundError", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const missing = Session.ID.create()
      const error = yield* sessions.form.list({ sessionID: missing }).pipe(Effect.flip)
      expect(error).toEqual(new Session.NotFoundError({ sessionID: missing }))
    }),
  )
})
