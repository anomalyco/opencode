import { fileURLToPath } from "node:url"
import { NodeHttpClient } from "@effect/platform-node"
import { Context, Effect, Layer, Match, Redacted, Schema } from "effect"
import * as AuthenticatedOriginInternal from "./authenticated-origin.ts"
import * as RelayClient from "./relay-client.ts"
import * as RelayLifecycle from "./relay-lifecycle.ts"
import type {
  AuthenticatedJsonMethod,
  AuthenticatedJsonOutcome,
  SessionSummary,
} from "./relay-schema.ts"

export type Json = Schema.Schema.Type<typeof Schema.Json>

export class ClientError extends Schema.TaggedError<ClientError>()(
  "OpenCodeBrowserClient.Error",
  {
    message: Schema.String,
    reason: Schema.Literals(["connect", "session", "invalid-request"]),
    code: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(Schema.Number),
  },
) {}

export class OriginMismatch extends Schema.TaggedError<OriginMismatch>()(
  "AuthenticatedOrigin.OriginMismatch",
  {
    expectedOrigin: Schema.String,
    actualOrigin: Schema.String,
    message: Schema.String,
  },
) {}

export class HttpError extends Schema.TaggedError<HttpError>()(
  "AuthenticatedOrigin.HttpError",
  {
    status: Schema.Number,
    method: Schema.String,
    message: Schema.String,
  },
) {}

export class RequestFailed extends Schema.TaggedError<RequestFailed>()(
  "AuthenticatedOrigin.RequestFailed",
  {
    method: Schema.String,
    message: Schema.String,
  },
) {}

export class RequestOutcomeUnknown extends Schema.TaggedError<RequestOutcomeUnknown>()(
  "AuthenticatedOrigin.RequestOutcomeUnknown",
  {
    method: Schema.String,
    message: Schema.String,
  },
) {}

export class InvalidResponse extends Schema.TaggedError<InvalidResponse>()(
  "AuthenticatedOrigin.InvalidResponse",
  {
    reason: Schema.Literals(["invalid-json", "too-large"]),
    status: Schema.Number,
    maxResponseBytes: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export class ResponseDecodeFailed extends Schema.TaggedError<ResponseDecodeFailed>()(
  "AuthenticatedOrigin.ResponseDecodeFailed",
  {
    message: Schema.String,
  },
) {}

export class SensitiveCaptureActive extends Schema.TaggedError<SensitiveCaptureActive>()(
  "AuthenticatedOrigin.SensitiveCaptureActive",
  {
    message: Schema.String,
  },
) {}

export type Error =
  | ClientError
  | OriginMismatch
  | HttpError
  | RequestFailed
  | RequestOutcomeUnknown
  | InvalidResponse
  | ResponseDecodeFailed
  | SensitiveCaptureActive

export interface JsonOptions<S extends Schema.Top> {
  readonly path: `/${string}`
  readonly method?: AuthenticatedJsonMethod
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Json
  readonly response: S
  readonly sensitive?: boolean
  readonly handoffOnAuthFailure?: boolean
  readonly handoffMessage?: string
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

export interface AuthenticatedOriginCapability {
  readonly origin: string
  readonly json: {
    <S extends Schema.Top>(
      options: JsonOptions<S> & { readonly sensitive: true },
    ): Effect.Effect<Redacted.Redacted<S["Type"]>, Error, S["DecodingServices"]>
    <S extends Schema.Top>(
      options: JsonOptions<S> & { readonly sensitive?: false },
    ): Effect.Effect<S["Type"], Error, S["DecodingServices"]>
  }
}

export type AuthenticatedOrigin = AuthenticatedOriginCapability

/** Reveal a sensitive response using OpenCode Browser's Effect runtime. */
export const reveal = <A>(value: Redacted.Redacted<A>): A => Redacted.value(value)

export interface AuthenticatedOriginOptions {
  readonly origin: string
  /** Explicitly navigate here when the session page is not already on `origin`. */
  readonly startUrl?: string
  /** Default headers merged into every request on this origin. */
  readonly headers?: Readonly<Record<string, string>>
  /** Present an in-page handoff prompt and retry once if the session is logged out or redirected to auth. */
  readonly handoffOnAuthFailure?: boolean
  readonly handoffMessage?: string
}

export interface OriginClientOptions extends Omit<AuthenticatedOriginOptions, "origin"> {
  readonly session: string
  readonly readOnly?: boolean
  readonly endpoint?: string
}

export interface OriginClient {
  readonly origin: string
  readonly session: string
  readonly get: <T = unknown>(
    path: `/${string}`,
    options?: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs?: number },
  ) => Promise<T>
  readonly post: <T = unknown>(
    path: `/${string}`,
    body?: Json,
    options?: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs?: number },
  ) => Promise<T>
  readonly json: AuthenticatedOriginCapability["json"]
}

export interface Session {
  readonly id: string
  readonly summary: SessionSummary
  readonly authenticatedOrigin: (
    options: AuthenticatedOriginOptions,
  ) => Effect.Effect<AuthenticatedOriginCapability, ClientError>
}

export interface EnsureSessionOptions {
  readonly id: string
  readonly readOnly?: boolean
}

export interface Interface {
  readonly ensureSession: (
    options: EnsureSessionOptions,
  ) => Effect.Effect<Session, ClientError>
  readonly resetSession: (id: string) => Effect.Effect<Session, ClientError>
}

export interface MakeOptions {
  readonly endpoint?: string
}

export class Service extends Context.Service<Service, Interface>()(
  "opencode-browser-cli/OpenCodeBrowserClient",
) {}

export const make = Effect.fn("OpenCodeBrowserClient.make")(function* (options: MakeOptions = {}) {
  const relay = yield* RelayClient.make(options).pipe(
    Effect.provide(NodeHttpClient.layerNodeHttp),
    Effect.mapError((error) => clientError("connect", error)),
  )
  const readiness = yield* RelayLifecycle.ensureRelay({
    relay,
    // The consumer may run under Bun; the relay is a Node application.
    start: RelayLifecycle.startManagedRelay(fileURLToPath(import.meta.url), "node", []),
  }).pipe(Effect.mapError((error) => clientError("connect", error)))
  if (readiness.buildProblem) {
    return yield* new ClientError({
      message: readiness.buildProblem,
      reason: "connect",
    })
  }
  yield* RelayLifecycle.ensureExtensionConnected({
    relay,
    waitForReconnect: true,
  }).pipe(Effect.mapError((error) => clientError("connect", error)))

  const ensureSession = Effect.fn("OpenCodeBrowserClient.ensureSession")(function* (
    sessionOptions: EnsureSessionOptions,
  ) {
    const summary = yield* relay.sessionEnsure(sessionOptions.id, {
      ...(sessionOptions.readOnly === undefined ? {} : { readOnly: sessionOptions.readOnly }),
    }).pipe(Effect.mapError((error) => clientError("session", error)))
    return makeSession(relay, summary)
  })

  const resetSession = Effect.fn("OpenCodeBrowserClient.resetSession")(function* (id: string) {
    const summary = yield* relay.sessionReset(id).pipe(
      Effect.mapError((error) => clientError("session", error)),
    )
    return makeSession(relay, summary)
  })

  return Service.of({ ensureSession, resetSession })
})

export const layer = (options: MakeOptions = {}): Layer.Layer<Service, ClientError> =>
  Layer.effect(Service, make(options))

export function origin(originUrl: string, options: OriginClientOptions): OriginClient {
  const normalizedOrigin = AuthenticatedOriginInternal.normalizeOrigin(originUrl)
  let cachedOrigin: Promise<AuthenticatedOriginCapability> | undefined
  const resolveOrigin = (): Promise<AuthenticatedOriginCapability> => {
    cachedOrigin ??= Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* make(options.endpoint ? { endpoint: options.endpoint } : {})
        const liveSession = yield* client.ensureSession({
          id: options.session,
          ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
        })
        return yield* liveSession.authenticatedOrigin({
          origin: normalizedOrigin,
          startUrl: options.startUrl ?? "/",
          ...(options.headers ? { headers: options.headers } : {}),
          ...(options.handoffOnAuthFailure === undefined ? {} : { handoffOnAuthFailure: options.handoffOnAuthFailure }),
          ...(options.handoffMessage ? { handoffMessage: options.handoffMessage } : {}),
        })
      }),
    ).catch((error) => {
      cachedOrigin = undefined
      throw error
    })
    return cachedOrigin
  }
  const json: AuthenticatedOriginCapability["json"] = ((request: JsonOptions<Schema.Top>) =>
    Effect.promise(resolveOrigin).pipe(
      Effect.flatMap((cap) => cap.json(request as JsonOptions<Schema.Top> & { readonly sensitive?: false })),
    )) as AuthenticatedOriginCapability["json"]

  return {
    origin: normalizedOrigin,
    session: options.session,
    get: async <T = unknown>(path: `/${string}`, callOptions?: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs?: number }) => {
      const cap = await resolveOrigin()
      return (await Effect.runPromise(cap.json({
        path,
        method: "GET",
        ...(callOptions?.headers ? { headers: callOptions.headers } : {}),
        ...(callOptions?.timeoutMs === undefined ? {} : { timeoutMs: callOptions.timeoutMs }),
        response: Schema.Json,
      }))) as T
    },
    post: async <T = unknown>(path: `/${string}`, body?: Json, callOptions?: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs?: number }) => {
      const cap = await resolveOrigin()
      return (await Effect.runPromise(cap.json({
        path,
        method: "POST",
        ...(body === undefined ? {} : { body }),
        ...(callOptions?.headers ? { headers: callOptions.headers } : {}),
        ...(callOptions?.timeoutMs === undefined ? {} : { timeoutMs: callOptions.timeoutMs }),
        response: Schema.Json,
      }))) as T
    },
    json,
  }
}

function makeSession(relay: RelayClient.Interface, summary: SessionSummary): Session {
  return {
    id: summary.id,
    summary,
    authenticatedOrigin: (options) => Effect.try({
      try: () => makeAuthenticatedOrigin(relay, summary.id, options),
      catch: (cause) => cause instanceof ClientError
        ? cause
        : new ClientError({
            message: cause instanceof globalThis.Error ? cause.message : "Invalid authenticated origin",
            reason: "invalid-request",
          }),
    }),
  }
}

function makeAuthenticatedOrigin(
  relay: RelayClient.Interface,
  sessionId: string,
  options: AuthenticatedOriginOptions,
): AuthenticatedOrigin {
  const origin = AuthenticatedOriginInternal.normalizeOrigin(options.origin)
  const startUrl = options.startUrl === undefined ? undefined : AuthenticatedOriginInternal.resolveStartUrl(origin, options.startUrl)

  function json<S extends Schema.Top>(
    request: JsonOptions<S> & { readonly sensitive: true },
  ): Effect.Effect<Redacted.Redacted<S["Type"]>, Error, S["DecodingServices"]>
  function json<S extends Schema.Top>(
    request: JsonOptions<S> & { readonly sensitive?: false },
  ): Effect.Effect<S["Type"], Error, S["DecodingServices"]>
  function json<S extends Schema.Top>(
    request: JsonOptions<S>,
  ): Effect.Effect<S["Type"] | Redacted.Redacted<S["Type"]>, Error, S["DecodingServices"]> {
    const method = request.method ?? "GET"
    if (method === "GET" && request.body !== undefined) {
      return Effect.fail(new ClientError({
        message: "GET authenticated origin requests cannot include a body",
        reason: "invalid-request",
      }))
    }
    const mutation = method !== "GET"
    const mergedHeaders =
      options.headers || request.headers
        ? { ...(options.headers ?? {}), ...(request.headers ?? {}) }
        : undefined
    const handoffOnAuthFailure = request.handoffOnAuthFailure ?? options.handoffOnAuthFailure
    const handoffMessage = request.handoffMessage ?? options.handoffMessage
    return relay.authenticatedJson({
      sessionId,
      origin,
      ...(startUrl ? { startUrl } : {}),
      method,
      path: request.path,
      ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.sensitive === true ? { sensitive: true } : {}),
      ...(handoffOnAuthFailure === undefined ? {} : { handoffOnAuthFailure }),
      ...(handoffMessage === undefined ? {} : { handoffMessage }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.maxResponseBytes === undefined ? {} : { maxResponseBytes: request.maxResponseBytes }),
    }).pipe(
      Effect.mapError((error): Error => mutation && (
          error instanceof RelayClient.RelayUnreachable || error instanceof RelayClient.RelayDecodeFailed
        )
        ? unknownOutcome(method)
        : clientError("session", error)),
      Effect.flatMap((outcome) => decodeOutcome(outcome, method, mutation, request)),
    )
  }

  return { origin, json }
}

function decodeOutcome<S extends Schema.Top>(
  outcome: AuthenticatedJsonOutcome,
  method: AuthenticatedJsonMethod,
  mutation: boolean,
  request: JsonOptions<S>,
): Effect.Effect<S["Type"] | Redacted.Redacted<S["Type"]>, Error, S["DecodingServices"]> {
  return Match.valueTags(outcome, {
    Success: (outcome) => {
      if (request.sensitive === true) {
        return Schema.decodeUnknownEffect(Schema.RedactedFromValue(request.response, {
          label: "OpenCode Browser authenticated response",
          disallowEncode: true,
        }))(outcome.value).pipe(
          Effect.mapError(() => mutation
            ? unknownOutcome(method)
            : new ResponseDecodeFailed({ message: "Sensitive authenticated response did not match the expected schema" })),
        )
      }
      return Schema.decodeUnknownEffect(request.response)(outcome.value).pipe(
        Effect.mapError((cause) => mutation
          ? unknownOutcome(method)
          : new ResponseDecodeFailed({ message: `Authenticated response did not match the expected schema: ${cause.message}` })),
      )
    },
    OriginMismatch: (outcome) =>
      Effect.fail(new OriginMismatch({
        expectedOrigin: outcome.expectedOrigin,
        actualOrigin: outcome.actualOrigin,
        message: `Session page origin ${outcome.actualOrigin} does not match ${outcome.expectedOrigin}`,
      })),
    HttpError: (outcome) =>
      Effect.fail(new HttpError({
        status: outcome.status,
        method,
        message: `Authenticated ${method} request was rejected with HTTP ${outcome.status}`,
      })),
    RequestFailed: (outcome) =>
      Effect.fail(mutation || outcome.outcome === "unknown"
        ? unknownOutcome(method)
        : new RequestFailed({ method, message: `Authenticated ${method} request failed before it was sent` })),
    InvalidJson: (outcome) =>
      Effect.fail(mutation
        ? unknownOutcome(method)
        : new InvalidResponse({
            reason: "invalid-json",
            status: outcome.status,
            message: "Authenticated response was not valid JSON",
          })),
    ResponseTooLarge: (outcome) =>
      Effect.fail(mutation
        ? unknownOutcome(method)
        : new InvalidResponse({
            reason: "too-large",
            status: outcome.status,
            maxResponseBytes: outcome.maxResponseBytes,
            message: `Authenticated response exceeded ${outcome.maxResponseBytes} bytes`,
          })),
    SensitiveCaptureActive: () =>
      Effect.fail(new SensitiveCaptureActive({
        message: "Sensitive authenticated requests are blocked while session network capture is active",
      })),
  })
}

function unknownOutcome(method: AuthenticatedJsonMethod): RequestOutcomeUnknown {
  return new RequestOutcomeUnknown({
    method,
    message: `Authenticated ${method} request outcome is unknown; reconcile state before retrying`,
  })
}

function clientError(reason: ClientError["reason"], error: unknown): ClientError {
  if (error instanceof ClientError) return error
  if (error instanceof RelayClient.RelayRejected) {
    return new ClientError({
      message: error.message,
      reason,
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
    })
  }
  return new ClientError({
    message: error instanceof globalThis.Error ? error.message : "OpenCode Browser request failed",
    reason,
  })
}
