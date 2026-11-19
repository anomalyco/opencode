import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.Info.time.suspended", () => {
  it.effect("exposes the durable write-ahead claim of an in-flight turn", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const store = yield* SessionStore.Service

      const created = yield* session.create({ location })
      expect(created.time.suspended).toBeUndefined()

      yield* store.claim(created.id)
      const claimed = yield* session.get(created.id)
      expect(claimed.time.suspended).toBeDefined()

      yield* store.release(created.id)
      const released = yield* session.get(created.id)
      expect(released.time.suspended).toBeUndefined()
    }),
  )
})
