export * as SessionWebhook from "./webhook.js"

import { Effect, FiberMap, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Form } from "@opencode-ai/schema/form"
import { Permission } from "@opencode-ai/schema/permission"
import { Bus } from "../bus.js"
import { SessionEvent } from "./event.js"
import { SessionSchema } from "./schema.js"
import { SessionMessage } from "./message.js"
import { SessionStore } from "./store.js"

export const make = Effect.fn("SessionWebhook.make")(function* () {
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const http = HttpClient.withScope(HttpClient.filterStatusOk(yield* HttpClient.HttpClient))
  // Capture the host context, not the submitting request's Location scope.
  const run = yield* FiberMap.makeRuntime<never, SessionSchema.ID, never, void>()

  return Effect.fn("SessionWebhook.subscribe")((sessionID: SessionSchema.ID, url: string) =>
    Effect.sync(() => {
      run(
        sessionID,
        bus
          .subscribe([
            SessionEvent.Execution.Started,
            SessionEvent.Execution.Succeeded,
            SessionEvent.Execution.Failed,
            SessionEvent.Execution.Interrupted,
            SessionEvent.Renamed,
            SessionEvent.Deleted,
            ...Permission.Event.Definitions,
            ...Form.Event.Definitions,
          ])
          .pipe(
            Stream.filter(
              (event) =>
                (event.type === "form.created" ? event.data.form.sessionID : event.data.sessionID) === sessionID,
            ),
            Stream.takeUntil(
              (event) =>
                event.type === "session.execution.succeeded" ||
                event.type === "session.execution.failed" ||
                event.type === "session.execution.interrupted" ||
                event.type === "session.deleted",
            ),
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                const session = yield* store.get(sessionID)
                const response = (yield* store.messages({ sessionID, type: "assistant", limit: 1 }))[0]
                yield* HttpClientRequest.post(url).pipe(
                  HttpClientRequest.bodyJson({
                    ...event,
                    session: session ? Schema.encodeSync(SessionSchema.Info)(session) : null,
                    response: response ? Schema.encodeSync(SessionMessage.Info)(response) : null,
                  }),
                  Effect.flatMap(http.execute),
                )
              }).pipe(
                Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
                Effect.scoped,
                Effect.timeout("5 seconds"),
                Effect.catch((error) =>
                  Effect.logWarning("Session webhook delivery failed", {
                    sessionID,
                    eventID: event.id,
                    eventType: event.type,
                    reason: error._tag,
                  }),
                ),
              ),
            ),
          ),
      )
    }),
  )
})
