import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { InstanceMap } from "@opencode-ai/core/instance-map"
import { stubLocations } from "./fixture/location"
import { Project } from "@opencode-ai/core/project"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor-service"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { Skill } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const projects = Layer.mock(Project.Service, {
  resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
})
const info = Skill.Info.make({
  id: Skill.ID.make("effect"),
  name: Skill.Name.make("Effect"),
  description: "Effect guidance",
  location: AbsolutePath.make(path.resolve("/skills/effect.md")),
  content: "Use Effect",
})
const skills = Layer.mergeAll(
  LayerNode.compile(PluginHooks.node),
  Layer.mock(Skill.Service, {
    get: (id) => Effect.succeed(id === info.id ? info : undefined),
    list: () => Effect.succeed([info]),
  }),
  Layer.succeed(PluginSupervisor.Service, { flush: Effect.void }),
)
// The skill endpoint only needs the location-scoped Skill service.
const locations = stubLocations(skills)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [InstanceMap.node, locations],
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("Session.skill", () => {
  it.effect("materializes mentioned skills on their owning prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const id = SessionMessage.ID.make("msg_skill_attachment")

      yield* sessions.prompt({
        id,
        sessionID: session.id,
        text: "Apply @effect and @effect",
        skills: [
          { id: Skill.ID.make("effect"), mention: { start: 6, end: 13, text: "@effect" } },
          { id: Skill.ID.make("effect"), mention: { start: 18, end: 25, text: "@effect" } },
        ],
        resume: false,
      })
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")

      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([
        expect.objectContaining({
          id,
          type: "user",
          text: "Apply @effect and @effect",
          skills: [
            {
              id: "effect",
              name: "Effect",
              text: Skill.toModelOutput(info, []),
              mention: { start: 6, end: 13, text: "@effect" },
            },
            {
              id: "effect",
              name: "Effect",
              mention: { start: 18, end: 25, text: "@effect" },
            },
          ],
        }),
      ])
    }),
  )

  it.effect("excludes mentioned skills when forking before their prompt", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location })
      const initial = SessionMessage.ID.make("msg_before_skill_attachment")
      const selected = SessionMessage.ID.make("msg_fork_skill_attachment")

      yield* sessions.prompt({ id: initial, sessionID: session.id, text: "Before the skill", resume: false })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      yield* sessions.prompt({
        id: selected,
        sessionID: session.id,
        text: "Apply @effect",
        skills: [{ id: info.id, mention: { start: 6, end: 13, text: "@effect" } }],
        resume: false,
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      const forked = yield* sessions.fork({ sessionID: session.id, boundary: { type: "before", messageID: selected } })

      expect(yield* sessions.messages({ sessionID: forked.id })).toEqual([
        expect.objectContaining({ type: "user", text: "Before the skill" }),
      ])
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
