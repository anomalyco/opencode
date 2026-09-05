import { describe, expect } from "bun:test"
import { Effect, Layer, RcMap, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Instance } from "@opencode-ai/core/instance/service"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
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
import { tmpdirScoped } from "./fixture/tmpdir"

const closed: Session.ID[] = []
const transportScopes = new Set<Scope.Scope>()
const transport = Layer.effect(
  SessionModelTransport.Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    transportScopes.add(scope)
    yield* Effect.addFinalizer(() => Effect.sync(() => transportScopes.delete(scope)))
    return SessionModelTransport.Service.of({
      bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
      close: (sessionID) => Effect.sync(() => closed.push(sessionID)),
      closeAll: Effect.void,
      steer: () => Effect.succeed(false),
      hasPendingInput: () => false,
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

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* session.environment({ sessionID: parent.id, variables: { SESSION_ENV: "parent" } })
      yield* session.environment({ sessionID: child.id, variables: { SESSION_ENV: "child" } })
      const locations = yield* LocationServiceMap.Service
      yield* Effect.acquireRelease(locations.contextEffect(location), () => locations.invalidate(location))
      closed.length = 0

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
      expect(closed).toEqual([parent.id, child.id])
      const environments = yield* SessionEnvironment.Service
      expect(yield* environments.get(parent.id)).toBeUndefined()
      expect(yield* environments.get(child.id)).toBeUndefined()
      expect(yield* Effect.result(session.get(parent.id))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.result(session.get(child.id))).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.live("removes unloaded sessions and children without initializing an instance", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const parent = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const child = yield* sessions.create({ parentID: parent.id })
      closed.length = 0
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* sessions.remove(parent.id)

      expect(closed).toEqual([parent.id, child.id])
      expect(transportScopes.size).toBe(1)
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
      expect((yield* sessions.list()).data).toEqual([])
    }),
  )

  it.effect("fails when the session does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing")

      expect(yield* Effect.result(session.remove(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.NotFoundError", sessionID },
      })
    }),
  )
})
