import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRollup } from "@opencode-ai/core/session/rollup"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { testEffect } from "./lib/effect"

describe("SessionRollup", () => {
  it("rolls up a single session", () => {
    const result = SessionRollup.rollup([{ id: "s1", cost: 2, tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } } }], "s1")
    expect(result.cost).toBe(2)
    expect(result.tokens.input).toBe(10)
    expect(result.subagents.cost).toBe(0)
  })

  it("rolls up descendants recursively into subagents", () => {
    const result = SessionRollup.rollup(
      [
        { id: "root", cost: 1, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "child", parentID: "root", cost: 2, tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "grandchild", parentID: "child", cost: 3, tokens: { input: 30, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      ],
      "root",
    )
    expect(result.cost).toBe(6)
    expect(result.tokens.input).toBe(60)
    expect(result.subagents.cost).toBe(5)
    expect(result.subagents.tokens.input).toBe(50)
  })

  it("treats children with a missing parent as unattached", () => {
    const result = SessionRollup.rollup(
      [
        { id: "root", cost: 1, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "orphan", parentID: "gone", cost: 9, tokens: { input: 90, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      ],
      "root",
    )
    expect(result.cost).toBe(1)
    expect(result.subagents.cost).toBe(0)
  })

  it("guards against parent_id cycles", () => {
    const result = SessionRollup.rollup(
      [
        { id: "root", cost: 1, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "a", parentID: "root", cost: 2, tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "b", parentID: "a", cost: 4, tokens: { input: 40, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      ],
      "root",
    )
    expect(result.cost).toBe(7)
    expect(result.subagents.cost).toBe(6)
  })

  it("fills zeros for an unknown root", () => {
    const result = SessionRollup.rollup([{ id: "other", cost: 5 }], "missing")
    expect(result.cost).toBe(0)
    expect(result.tokens.input).toBe(0)
  })
})

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it2 = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("SessionV2.cost", () => {
  it2.effect("rolls up the project subtree for a session", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = yield* SessionV2.Service
      const root = yield* session.create({ location })
      const insert = (id: string, parentID: string | null, cost: number, input: number) =>
        db
          .insert(SessionTable)
          .values({
            id: SessionV2.ID.make(id),
            project_id: root.projectID,
            parent_id: parentID ? SessionV2.ID.make(parentID) : undefined,
            slug: id,
            directory: "/project",
            title: id,
            version: "test",
            cost,
            tokens_input: input,
          })
          .run()
          .pipe(Effect.orDie)
            yield* insert("ses_child", root.id, 0.02, 100)
      yield* insert("ses_grandchild", "ses_child", 0.03, 200)
      yield* insert("ses_sibling", null, 5, 500)

      const result = yield* session.cost(root.id)

      expect(result.cost).toBeCloseTo(0.05, 10)
      expect(result.tokens.input).toBe(300)
      expect(result.subagents.cost).toBeCloseTo(0.05, 10)
      expect(result.subagents.tokens.input).toBe(300)
    }),
  )

  it2.effect("fails with NotFoundError for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* Effect.flip(session.cost(SessionV2.ID.make("ses_missing")))
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )
})