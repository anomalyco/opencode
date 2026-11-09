import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const ref = location({ directory: AbsolutePath.make("test") })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node, Database.node]), [
    Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(ref))),
  ]),
)

const providerID = Provider.ID.make("fixture")
const newest = Model.ID.make("newest")
const used = Model.ID.make("used")
const failed = Model.ID.make("failed")
const configured = Model.ID.make("configured")
const sessionID = Session.ID.make("ses_model_default")

const catalog = Effect.gen(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(providerID, () => {})
    for (const [id, released] of [
      [newest, 4000],
      [used, 3000],
      [failed, 2000],
      [configured, 1000],
    ] as const)
      editor.models.update(providerID, id, (model) => {
        model.time.released = released
      })
  })
})

let seq = 0
const assistant = (model: Model.ID, created: number, options: { error?: boolean; completed?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    seq++
    yield* db
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.make(`msg_model_default_${seq}`),
        session_id: sessionID,
        type: "assistant",
        seq,
        time_created: created,
        data: {
          agent: "build",
          model: { providerID, id: model },
          content: [],
          ...(options.error ? { error: { type: "unknown", message: "failed" } } : {}),
          time: { created, ...(options.completed === false ? {} : { completed: created + 1 }) },
        } as never,
      })
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.make("model-default"), worktree: AbsolutePath.make("/test"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.make("model-default"),
      slug: "model-default",
      directory: "/test",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  yield* catalog
})

it.effect("defaults to the newest released model without history", () =>
  Effect.gen(function* () {
    yield* setup
    expect((yield* (yield* Model.Service).default())?.id).toBe(newest)
  }),
)

it.effect("defaults to the model of the latest successful turn", () =>
  Effect.gen(function* () {
    yield* setup
    yield* assistant(used, 1000)
    yield* assistant(failed, 2000, { error: true })
    yield* assistant(failed, 3000, { completed: false })
    expect((yield* (yield* Model.Service).default())?.id).toBe(used)
  }),
)

it.effect("prefers the configured default over history", () =>
  Effect.gen(function* () {
    yield* setup
    yield* assistant(used, 1000)
    const models = yield* Model.Service
    yield* models.transform((editor) => editor.default.set(providerID, configured))
    expect((yield* models.default())?.id).toBe(configured)
  }),
)

it.effect("falls back to release order when the last used model is unavailable", () =>
  Effect.gen(function* () {
    yield* setup
    yield* assistant(used, 1000)
    const models = yield* Model.Service
    yield* models.transform((editor) => editor.remove(providerID, used))
    expect((yield* models.default())?.id).toBe(newest)
  }),
)
