import { Effect, Stream } from "effect"
import { HttpClient } from "effect/unstable/http"
import { ClientError, OpenCode } from "./generated"
import { Missing } from "./fixture"

export const program = OpenCode.make().pipe(
  Effect.map((client) => {
    const health = client.session.health()
    const list = client.session.list()
    const filtered = client.session.list({ archived: true })
    const get = client.session.get({ sessionID: "session" })
    const interrupt = client.session.interrupt({ sessionID: "session" })
    const status = client.status()
    const subscribe = client.event.subscribe()

    const _health: Effect.Effect<string, ClientError> = health
    const _list: Effect.Effect<ReadonlyArray<string>, ClientError> = list
    const _filtered: Effect.Effect<ReadonlyArray<string>, ClientError> = filtered
    const _get: Effect.Effect<string, Missing | ClientError> = get
    const _interrupt: Effect.Effect<void, ClientError> = interrupt
    const _status: Effect.Effect<string, ClientError> = status
    const _subscribe: Stream.Stream<{ readonly type: string }, ClientError> = subscribe

    return { _health, _list, _filtered, _get, _interrupt, _status, _subscribe }
  }),
)

const _requiresHttpClient: Effect.Effect<unknown, never, HttpClient.HttpClient> = program
