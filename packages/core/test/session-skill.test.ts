import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const projects = Layer.mock(ProjectV2.Service, {
  resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
})
const skills = Layer.mock(SkillV2.Service, {
  list: () =>
    Effect.succeed([
      SkillV2.Info.make({
        id: SkillV2.ID.make("effect"),
        name: SkillV2.Name.make("Effect"),
        description: "Effect guidance",
        location: AbsolutePath.make(path.resolve("/skills/effect/SKILL.md")),
        content: "Use Effect",
      }),
    ]),
})
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // The skill endpoint only needs the location-scoped Skill service.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      skills as unknown as Layer.Layer<LocationServices>,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [LocationServiceMap.node, locations],
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("SessionV2.skill", () => {
  it.effect("projects the caller-supplied message ID", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_caller_skill")

      yield* sessions.skill({ id, sessionID: session.id, skill: SkillV2.ID.make("effect"), resume: false })

      expect(yield* sessions.messages({ sessionID: session.id })).toContainEqual(
        expect.objectContaining({ id, type: "skill", skill: "effect", name: "Effect", text: "Use Effect" }),
      )
    }),
  )
})
