export * as BitcostClient from "./client"

import path from "path"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
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

export function shouldRelaxTlsForLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".test")
  } catch {
    return false
  }
}

export function withLocalTls<A, E, R>(url: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  if (!shouldRelaxTlsForLocal(url)) return effect
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
      return prev
    }),
    () => effect,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
      }),
  )
}

export type UsageReport = {
  readonly taskID: string
  readonly idempotencyKey: string
  readonly requestID?: string
  readonly session?: string
  readonly model: string
  readonly provider: string
  readonly variant?: string
  /** The CLI's catalog-computed cost of the turn (USD). */
  readonly cost?: number
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache: { readonly read: number; readonly write: number }
  }
}

/**
 * The JSON body POSTed to `/api/tasks/{id}/usage`. The server recomputes cost
 * from tokens+model; `cost` is the CLI's own estimate, kept for audit and used
 * by the server as a fallback when it has no pricing for the model.
 */
export function usageRequestBody(report: UsageReport) {
  return {
    idempotency_key: report.idempotencyKey,
    request_id: report.requestID,
    session: report.session,
    provider: report.provider,
    model: report.model,
    variant: report.variant,
    cost: report.cost,
    tokens: report.tokens,
  }
}

export interface Interface {
  /** The stored credentials, or `None` when the user is not logged in. */
  readonly auth: () => Effect.Effect<Option.Option<Auth>>
  readonly isLoggedIn: () => Effect.Effect<boolean>
  readonly listTasks: () => Effect.Effect<ReadonlyArray<Task>, Error | Unauthenticated>
  readonly createTask: (input: { name: string; requestID?: string }) => Effect.Effect<Task, Error | Unauthenticated>
  readonly completeTask: (taskID: string) => Effect.Effect<void, Error | Unauthenticated>
  readonly reportUsage: (report: UsageReport) => Effect.Effect<void, Error | Unauthenticated>
  readonly attachPlan: (input: {
    taskID: string
    requestID?: string
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

const traceID = (prefix: string, suffix?: string) => `${prefix}:${suffix ?? crypto.randomUUID()}`

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

    const withTrace = (requestID: string, request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(HttpClientRequest.setHeader("X-Bitcost-Trace-ID", requestID))

    const fail = (message: string) => (cause: unknown) =>
      new Error({ message: `${message}: ${cause instanceof globalThis.Error ? cause.message : String(cause)}` })

    return Service.of({
      auth: () => readAuthFile(),
      isLoggedIn: () => readAuthFile().pipe(Effect.map(Option.isSome)),
      listTasks: () =>
        authed((auth) =>
          withLocalTls(
            `${baseUrl(auth)}/api/tasks`,
            withAuth(auth, HttpClientRequest.get(`${baseUrl(auth)}/api/tasks`)).pipe(
              http.execute,
              Effect.flatMap((res) => res.json),
              Effect.flatMap(Schema.decodeUnknownEffect(TaskList)),
              Effect.map((body) => body.data),
              Effect.catch((cause) => fail("listTasks failed")(cause)),
            ),
          ),
        ),
      createTask: (input) =>
        authed((auth) =>
          withLocalTls(
            `${baseUrl(auth)}/api/tasks`,
            HttpClientRequest.post(`${baseUrl(auth)}/api/tasks`).pipe(
              (request) => withAuth(auth, request),
              (request) => withTrace(input.requestID ?? traceID("task-create"), request),
              HttpClientRequest.bodyJsonUnsafe({ name: input.name }),
              http.execute,
              Effect.flatMap((res) => res.json),
              Effect.flatMap(Schema.decodeUnknownEffect(TaskEnvelope)),
              Effect.map((body) => body.data),
              Effect.catch((cause) => fail("createTask failed")(cause)),
            ),
          ),
        ),
      completeTask: (taskID) =>
        authed((auth) =>
          withLocalTls(
            `${baseUrl(auth)}/api/tasks/${taskID}/complete`,
            HttpClientRequest.patch(`${baseUrl(auth)}/api/tasks/${taskID}/complete`).pipe(
              (request) => withAuth(auth, request),
              http.execute,
              Effect.asVoid,
              Effect.catch((cause) => fail("completeTask failed")(cause)),
            ),
          ),
        ),
      reportUsage: (report) =>
        authed((auth) =>
          withLocalTls(
            `${baseUrl(auth)}/api/tasks/${report.taskID}/usage`,
            HttpClientRequest.post(`${baseUrl(auth)}/api/tasks/${report.taskID}/usage`).pipe(
              (request) => withAuth(auth, request),
              (request) => withTrace(report.requestID ?? traceID("usage", `${report.taskID}:${report.idempotencyKey}`), request),
              HttpClientRequest.bodyJsonUnsafe(usageRequestBody(report)),
              http.execute,
              Effect.asVoid,
              Effect.catch((cause) => fail("reportUsage failed")(cause)),
            ),
          ),
        ),
      attachPlan: (input) =>
        authed((auth) =>
          withLocalTls(
            `${baseUrl(auth)}/api/tasks/${input.taskID}/plans`,
            HttpClientRequest.post(`${baseUrl(auth)}/api/tasks/${input.taskID}/plans`).pipe(
              (request) => withAuth(auth, request),
              (request) => withTrace(input.requestID ?? traceID("task-plan", input.taskID), request),
              HttpClientRequest.bodyJsonUnsafe({ title: input.title, body: input.body }),
              http.execute,
              Effect.asVoid,
              Effect.catch((cause) => fail("attachPlan failed")(cause)),
            ),
          ),
        ),
    })
  }),
)

export const node = LayerNode.make(layer, [httpClient])

/** Standalone layer for runtimes composed via `Layer.mergeAll` (e.g. AppRuntime). */
export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))
