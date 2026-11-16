import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionPermissionTable, SessionQuestionTable } from "@opencode/core/session/sql"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { createEmbeddedRoutes } from "../src/routes"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"

for (const decision of ["once", "always", "reject"] as const) {
  it.live(
    `lists and resolves a Permission through existing HTTP routes after reopening the server database (${decision})`,
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const routes = () =>
          Layer.fresh(
            createEmbeddedRoutes(
              {
                app: { version: "test" },
                database: { path: `${directory.path}/server.sqlite` },
                fs: { filewatcher: false },
                models: { fetch: false },
              },
              [SessionExecution.node.replace(SessionExecution.noopLayer), Global.node.replace(tempGlobalLayer)],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
        const requestID = Permission.ID.create()
        const questionID = Form.ID.create()
        const assistantMessageID = SessionMessage.ID.create()
        const created = yield* Effect.gen(function* () {
          const context = yield* Layer.build(routes())
          const sessions = Context.get(context, Session.Service)
          const bus = Context.get(context, Bus.Service)
          const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })
          const started = yield* bus.publish(SessionEvent.Step.Started, {
            sessionID: session.id,
            assistantMessageID,
            agent: Agent.ID.make("build"),
            started: 0,
            model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
          })
          yield* bus.publish(SessionEvent.Tool.Input.Started, {
            sessionID: session.id,
            assistantMessageID,
            id: "call",
            name: "question",
          })
          yield* bus.publish(SessionEvent.Tool.Called, {
            sessionID: session.id,
            assistantMessageID,
            id: "call",
            input: {},
            executed: false,
          })
          yield* bus.publish(SessionEvent.Step.Streamed, { sessionID: session.id, assistantMessageID })
          yield* bus.publish(SessionEvent.Step.Parked, {
            sessionID: session.id,
            assistantMessageID,
            generation: started.durable.seq,
            step: 1,
            finish: "tool-calls",
            cost: Money.USD.zero,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            questions: [
              {
                callID: "call",
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
                permission: {
                  request: {
                    id: requestID,
                    sessionID: session.id,
                    action: "question",
                    resources: ["*"],
                    save: ["*"],
                    source: { type: "tool", messageID: assistantMessageID, id: "call" },
                  },
                  agent: Agent.ID.make("build"),
                },
              },
            ],
          })
          return session
        }).pipe(Effect.scoped)

        yield* Effect.gen(function* () {
          const context = yield* Layer.build(routes())
          const db = Context.get(context, Database.Service).db
          const instances = Context.get(context, Instance.Service)
          const sessions = Context.get(context, Session.Service)
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const request = (path: string, body?: unknown) =>
            Effect.promise(async () => {
              const response = await handler(
                new Request(`http://opencode.local${path}`, {
                  method: body === undefined ? "GET" : "POST",
                  headers: { "content-type": "application/json" },
                  body: body === undefined ? undefined : JSON.stringify(body),
                }),
              )
              const responseText = await response.text()
              return { status: response.status, body: responseText ? JSON.parse(responseText) : undefined }
            })
          const base = `/api/session/${created.id}/permission`
          expect(instances.live && (yield* instances.live(created))).toBe(false)
          expect(yield* request(base)).toMatchObject({
            status: 200,
            body: { data: [{ id: requestID, sessionID: created.id }] },
          })
          expect(yield* request(`${base}/${requestID}`)).toMatchObject({
            status: 200,
            body: {
              data: {
                id: requestID,
                source: { type: "tool", messageID: assistantMessageID, id: "call" },
              },
            },
          })
          expect(
            yield* request(`/api/permission/request?location[directory]=${encodeURIComponent(directory.path)}`),
          ).toMatchObject({ status: 200, body: { data: [{ id: requestID }] } })
          const other = yield* sessions.create({ location: created.location })
          expect((yield* request(`/api/session/${other.id}/permission/${requestID}`)).status).toBe(404)
          expect((yield* request(`/api/session/${other.id}/permission/${requestID}/reply`, { decision })).status).toBe(
            404,
          )
          expect((yield* request(`${base}/${requestID}/reply`, { decision })).status).toBe(204)
          expect((yield* request(`${base}/${requestID}/reply`, { decision })).status).toBe(404)
          expect(yield* request(base)).toEqual({ status: 200, body: { data: [] } })
          expect(yield* db.select().from(SessionPermissionTable).get()).toMatchObject({
            id: requestID,
            status: decision,
          })
          if (decision === "reject") {
            expect(yield* db.select().from(SessionQuestionTable)).toEqual([])
            return
          }
          expect(yield* request(`/api/session/${created.id}/form`)).toMatchObject({
            status: 200,
            body: { data: [{ id: questionID }] },
          })
          expect(
            (yield* request(`/api/session/${created.id}/form/${questionID}/reply`, { answer: { q0: "Yes" } })).status,
          ).toBe(204)
          expect(yield* db.select().from(SessionQuestionTable).get()).toMatchObject({
            id: questionID,
            status: "answered",
          })
        }).pipe(Effect.scoped)
      }).pipe(Effect.scoped),
  )
}
