import { expect } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("updates completed assistant message content through the session HTTP API", () =>
  Effect.gen(function* () {
    const state = {
      active: new Set<Session.ID>(),
      user: SessionMessage.ID.create(),
      assistant: SessionMessage.ID.create(),
      complete: true,
    }
    const execution = Layer.effect(
      SessionExecution.Service,
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return SessionExecution.Service.of({
          active: Effect.sync(() => state.active),
          resume: () => Effect.void,
          wake: (sessionID) =>
            Effect.gen(function* () {
              yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: state.user })
              yield* bus.publish(SessionEvent.Step.Started, {
                sessionID,
                assistantMessageID: state.assistant,
                agent: Agent.defaultID,
                model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
              })
              if (!state.complete) return
              yield* bus.publish(SessionEvent.Step.Ended, {
                sessionID,
                assistantMessageID: state.assistant,
                finish: "stop",
                cost: Money.USD.make(0),
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              })
            }),
          interrupt: () => Effect.succeed(false),
          awaitIdle: () => Effect.void,
        })
      }),
    )
    const handler = yield* ServerFetch.make(
      { app: { version: "test-version" }, database: { path: ":memory:" }, fs: { filewatcher: false } },
      { overrides: [[SessionExecution.node, execution]] },
    )
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ).then((response) => response.json()),
    )
    const sessionID = Session.ID.make(created.data.id)
    const prompt = () =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/session/${sessionID}/prompt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: state.user, text: "prompt" }),
          }),
        ),
      )
    const update = (messageID: SessionMessage.ID, body: unknown, id = sessionID) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/session/${id}/message/${messageID}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )

    expect((yield* prompt()).status).toBe(200)
    const content = [
      { type: "text", text: "edited assistant response" },
      { type: "reasoning", text: "edited reasoning", time: { created: 123 } },
    ]
    const updated = yield* update(state.assistant, { content })
    expect(updated.status).toBe(200)
    expect(yield* Effect.promise(() => updated.json())).toMatchObject({
      data: { id: state.assistant, type: "assistant", content },
    })

    const projected = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${sessionID}/message/${state.assistant}`)).then(
        (response) => response.json(),
      ),
    )
    expect(projected.data.content).toEqual(content)
    expect((yield* update(state.assistant, { text: "not a content array" })).status).toBe(400)
    const unfinished = yield* update(state.assistant, {
      content: [
        {
          type: "tool",
          id: "call_unfinished",
          name: "read",
          state: { status: "streaming", input: "" },
          time: { created: 123 },
        },
      ],
    })
    expect(unfinished.status).toBe(400)
    expect(yield* Effect.promise(() => unfinished.json())).toMatchObject({
      _tag: "InvalidRequestError",
      field: "content",
    })
    const nonAssistant = yield* update(state.user, { content: [] })
    expect(nonAssistant.status).toBe(400)
    expect(yield* Effect.promise(() => nonAssistant.json())).toMatchObject({ _tag: "InvalidRequestError" })
    expect((yield* update(SessionMessage.ID.create(), { content: [] })).status).toBe(404)
    expect((yield* update(state.assistant, { content: [] }, Session.ID.create())).status).toBe(404)

    state.active.add(sessionID)
    const busy = yield* update(state.assistant, { content: [] })
    state.active.delete(sessionID)
    expect(busy.status).toBe(409)
    expect(yield* Effect.promise(() => busy.json())).toMatchObject({ _tag: "SessionBusyError", sessionID })

    state.user = SessionMessage.ID.create()
    state.assistant = SessionMessage.ID.create()
    state.complete = false
    expect((yield* prompt()).status).toBe(200)
    const incomplete = yield* update(state.assistant, { content: [] })
    expect(incomplete.status).toBe(409)
    expect(yield* Effect.promise(() => incomplete.json())).toMatchObject({
      _tag: "ConflictError",
      resource: state.assistant,
    })
  }).pipe(Effect.scoped),
)
