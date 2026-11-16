import { expect } from "bun:test"
import fs from "fs/promises"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionPendingStepTable, SessionQuestionTable } from "@opencode/core/session/sql"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { createEmbeddedRoutes } from "../src/routes"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("lists no forms for a Session whose Location is not live, and pending forms once it is", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: await response.json() }
      })
    const create = (directory: string) =>
      request("/api/session", { location: { directory } }).pipe(
        Effect.map((response) => (response.body as { data: { id: string } }).data.id),
      )

    // A subagent whose worktree was deleted must not boot or 404.
    const deleted = yield* tmpdirScoped()
    const orphan = yield* create(deleted.path)
    yield* Effect.promise(() => fs.rm(deleted.path, { recursive: true, force: true }))
    expect(yield* request(`/api/session/${orphan}/form`)).toEqual({ status: 200, body: { data: [] } })

    const directory = yield* tmpdirScoped()
    const live = yield* create(directory.path)
    const created = yield* request(`/api/session/${live}/form`, {
      title: "Pick one",
      fields: [{ key: "answer", type: "string" }],
    })
    expect(created.status).toBe(200)
    expect(yield* request(`/api/session/${live}/form`)).toEqual({
      status: 200,
      body: { data: [(created.body as { data: unknown }).data] },
    })
  }).pipe(Effect.scoped),
)

for (const outcome of ["answer", "feedback", "dismiss"] as const) {
  it.live(`exposes a cold durable Question through the public Form API (${outcome})`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const context = yield* Layer.build(
        createEmbeddedRoutes(
          {
            app: { version: "test" },
            database: { path: ":memory:" },
            fs: { filewatcher: false },
            models: { fetch: false },
          },
          [SessionExecution.node.replace(SessionExecution.noopLayer)],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sessions = Context.get(context, Session.Service)
      const bus = Context.get(context, Bus.Service)
      const db = Context.get(context, Database.Service).db
      const instances = Context.get(context, Instance.Service)
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })
      const assistantMessageID = SessionMessage.ID.create()
      const questionID = Form.ID.create()
      const started = yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: created.id,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        started: 0,
        model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID: created.id,
        assistantMessageID,
        id: "question",
        name: "question",
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID: created.id,
        assistantMessageID,
        id: "question",
        input: {},
        executed: false,
      })
      yield* bus.publish(SessionEvent.Step.Streamed, { sessionID: created.id, assistantMessageID })
      yield* bus.publish(SessionEvent.Step.Parked, {
        sessionID: created.id,
        assistantMessageID,
        generation: started.durable.seq,
        step: 1,
        finish: "tool-calls",
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        questions: [
          {
            callID: "question",
            questionID,
            prepared: {
              adapter: "question@1",
              input: {
                questions: [
                  {
                    question: "Continue?",
                    header: "Continue",
                    options: [{ label: "Yes", description: "Continue" }],
                  },
                ],
              },
            },
          },
        ],
      })
      const request = (suffix = "", init?: RequestInit) =>
        Effect.promise(() =>
          handler(new Request(`http://opencode.local/api/session/${created.id}/form${suffix}`, init)),
        )
      expect(instances.live && (yield* instances.live(created))).toBe(false)
      const listed = yield* request()
      expect(listed.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Form.Info) }))(
          yield* Effect.promise(() => listed.json()),
        ).data,
      ).toMatchObject([{ id: questionID, sessionID: created.id }])
      expect(instances.live && (yield* instances.live(created))).toBe(false)
      const detail = yield* request(`/${questionID}`)
      expect(detail.status).toBe(200)
      expect(yield* Effect.promise(() => detail.json())).toMatchObject({
        data: { id: questionID, state: { status: "pending" } },
      })
      const reply =
        outcome === "answer"
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ answer: { q0: "Yes" } }),
            }
          : { method: "DELETE" }
      const suffix = `/${questionID}${outcome === "answer" ? "/reply" : outcome === "feedback" ? "?message=Use%20defaults" : ""}`
      expect((yield* request(suffix, reply)).status).toBe(204)
      expect((yield* request(suffix, reply)).status).toBe(409)
      const remaining = yield* request()
      expect(yield* Effect.promise(() => remaining.json())).toEqual({ data: [] })
      expect(yield* db.select().from(SessionQuestionTable).get()).toMatchObject(
        outcome === "answer"
          ? { status: "answered", answer: { q0: "Yes" } }
          : { status: "cancelled", cancel_message: outcome === "feedback" ? "Use defaults" : null },
      )
      if (outcome !== "answer") expect(yield* db.select().from(SessionPendingStepTable)).toEqual([])
    }).pipe(Effect.scoped),
  )
}
