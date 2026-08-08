import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { Skill } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const projects = Layer.mock(Project.Service, {
  resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
})
const effectSkill = Skill.Info.make({
  id: Skill.ID.make("effect"),
  name: Skill.Name.make("Effect"),
  description: "Effect guidance",
  location: AbsolutePath.make(path.resolve("/skills/effect.md")),
  content: "Use Effect",
})
let listedSkills: Skill.Info[] = [effectSkill]
const skills = Layer.mock(Skill.Service, {
  list: () => Effect.sync(() => listedSkills),
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
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [LocationServiceMap.node, locations],
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("Session.skill", () => {
  it.effect("reconciles a promoted skill prompt after the live skill disappears", () =>
    Effect.gen(function* () {
      listedSkills = [effectSkill]
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const input = {
        id: SessionMessage.ID.make("msg_skill_retry"),
        sessionID: session.id,
        text: "Apply this guidance",
        skills: [{ id: Skill.ID.make("effect") }],
        resume: false,
      }

      yield* sessions.prompt(input)
      yield* SessionPending.promote(database.db, bus, session.id, "steer")
      listedSkills = []

      expect(yield* sessions.prompt(input)).toMatchObject({ id: input.id, data: { text: input.text } })
    }).pipe(Effect.ensuring(Effect.sync(() => (listedSkills = [effectSkill])))),
  )

  it.effect("attaches a resolved skill snapshot to a normal prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_skill_attachment")

      yield* sessions.prompt({
        id,
        sessionID: session.id,
        text: "Apply this guidance",
        skills: [{ id: Skill.ID.make("effect"), mention: { start: 20, end: 27, text: "/effect" } }],
        resume: false,
      })
      yield* SessionPending.promote(database.db, bus, session.id, "steer")

      expect(yield* sessions.messages({ sessionID: session.id })).toContainEqual(
        expect.objectContaining({
          id,
          type: "user",
          text: "Apply this guidance",
          skills: [
            {
              id: "effect",
              name: "Effect",
              text: expect.stringContaining("Use Effect"),
              mention: { start: 20, end: 27, text: "/effect" },
            },
          ],
        }),
      )
    }),
  )

  it.effect("projects the caller-supplied message ID", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_caller_skill")

      yield* sessions.skill({ id, sessionID: session.id, skill: Skill.ID.make("effect"), resume: false })

      expect(yield* sessions.messages({ sessionID: session.id })).toContainEqual(
        expect.objectContaining({ id, type: "skill", skill: "effect", name: "Effect", text: "Use Effect" }),
      )
    }),
  )
})
