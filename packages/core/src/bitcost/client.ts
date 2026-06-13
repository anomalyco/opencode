export * as BitcostClient from "./client"

import path from "path"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Global } from "../global"
import { LayerNode } from "../effect/layer-node"
import { httpClient } from "../effect/layer-node-platform"

// Bitcost credentials are written by the TUI login dialog into a sibling
// `bitcost/` directory next to opencode's own data dir.
const AUTH_FILE = path.join(path.dirname(Global.Path.data), "bitcost", "bitcost-auth.json")

export const Auth = Schema.Struct({
  url: Schema.String,
  name: Schema.optional(Schema.NullishOr(Schema.String)),
  email: Schema.optional(Schema.NullishOr(Schema.String)),
  department: Schema.optional(Schema.NullishOr(Schema.String)),
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.NullishOr(Schema.String)),
  expires_at: Schema.optional(Schema.NullishOr(Schema.Number)),
})
export type Auth = typeof Auth.Type

export const Task = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
})
export type Task = typeof Task.Type

const TaskList = Schema.Struct({ data: Schema.Array(Task) })
const TaskEnvelope = Schema.Struct({ data: Task })

export class Error extends Schema.TaggedErrorClass<Error>()("Bitcost.ClientError", {
  message: Schema.String,
}) {}

export class Unauthenticated extends Schema.TaggedErrorClass<Unauthenticated>()("Bitcost.Unauthenticated", {}) {}

export type UsageReport = {
  readonly taskID: string
  readonly idempotencyKey: string
  readonly session?: string
  readonly model: string
  readonly provider: string
  readonly variant?: string
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache: { readonly read: number; readonly write: number }
  }
}

export interface Interface {
  /** The stored credentials, or `None` when the user is not logged in. */
  readonly auth: () => Effect.Effect<Option.Option<Auth>>
  readonly isLoggedIn: () => Effect.Effect<boolean>
  readonly listTasks: () => Effect.Effect<ReadonlyArray<Task>, Error | Unauthenticated>
  readonly createTask: (input: { name: string }) => Effect.Effect<Task, Error | Unauthenticated>
  readonly completeTask: (taskID: string) => Effect.Effect<void, Error | Unauthenticated>
  readonly reportUsage: (report: UsageReport) => Effect.Effect<void, Error | Unauthenticated>
  readonly attachPlan: (input: {
    taskID: string
    title?: string
    body: string
  }) => Effect.Effect<void, Error | Unauthenticated>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Bitcost/Client") {}

const readAuthFile = Effect.fnUntraced(function* () {
  const decoded = yield* Effect.tryPromise(() => Bun.file(AUTH_FILE).json()).pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(Auth)(json)),
    Effect.option,
  )
  return decoded
})

const baseUrl = (auth: Auth) => auth.url.replace(/\/+$/, "")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(
      (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      ),
    )

    const authed = <A>(
      run: (auth: Auth) => Effect.Effect<A, Error>,
    ): Effect.Effect<A, Error | Unauthenticated> =>
      Effect.gen(function* () {
        const maybe = yield* readAuthFile()
        if (Option.isNone(maybe)) return yield* Effect.fail(new Unauthenticated())
        return yield* run(maybe.value)
      })

    const withAuth = (auth: Auth, request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${auth.access_token}`),
        HttpClientRequest.accept("application/json"),
      )

    const fail = (message: string) => (cause: unknown) =>
      new Error({ message: `${message}: ${cause instanceof globalThis.Error ? cause.message : String(cause)}` })

    return Service.of({
      auth: () => readAuthFile(),
      isLoggedIn: () => readAuthFile().pipe(Effect.map(Option.isSome)),
      listTasks: () =>
        authed((auth) =>
          withAuth(auth, HttpClientRequest.get(`${baseUrl(auth)}/api/tasks`)).pipe(
            http.execute,
            Effect.flatMap((res) => res.json),
            Effect.flatMap(Schema.decodeUnknownEffect(TaskList)),
            Effect.map((body) => body.data),
            Effect.catch((cause) => fail("listTasks failed")(cause)),
          ),
        ),
      createTask: (input) =>
        authed((auth) =>
          HttpClientRequest.post(`${baseUrl(auth)}/api/tasks`).pipe(
            (request) => withAuth(auth, request),
            HttpClientRequest.bodyJsonUnsafe({ name: input.name }),
            http.execute,
            Effect.flatMap((res) => res.json),
            Effect.flatMap(Schema.decodeUnknownEffect(TaskEnvelope)),
            Effect.map((body) => body.data),
            Effect.catch((cause) => fail("createTask failed")(cause)),
          ),
        ),
      completeTask: (taskID) =>
        authed((auth) =>
          HttpClientRequest.patch(`${baseUrl(auth)}/api/tasks/${taskID}/complete`).pipe(
            (request) => withAuth(auth, request),
            http.execute,
            Effect.asVoid,
            Effect.catch((cause) => fail("completeTask failed")(cause)),
          ),
        ),
      reportUsage: (report) =>
        authed((auth) =>
          HttpClientRequest.post(`${baseUrl(auth)}/api/tasks/${report.taskID}/usage`).pipe(
            (request) => withAuth(auth, request),
            HttpClientRequest.bodyJsonUnsafe({
              idempotency_key: report.idempotencyKey,
              session: report.session,
              provider: report.provider,
              model: report.model,
              variant: report.variant,
              tokens: report.tokens,
            }),
            http.execute,
            Effect.asVoid,
            Effect.catch((cause) => fail("reportUsage failed")(cause)),
          ),
        ),
      attachPlan: (input) =>
        authed((auth) =>
          HttpClientRequest.post(`${baseUrl(auth)}/api/tasks/${input.taskID}/plans`).pipe(
            (request) => withAuth(auth, request),
            HttpClientRequest.bodyJsonUnsafe({ title: input.title, body: input.body }),
            http.execute,
            Effect.asVoid,
            Effect.catch((cause) => fail("attachPlan failed")(cause)),
          ),
        ),
    })
  }),
)

export const node = LayerNode.make(layer, [httpClient])
