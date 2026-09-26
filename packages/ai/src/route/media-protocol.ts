import { Clock, Duration, Effect, Schema, type Stream } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import type { Snapshot, Status } from "../generation.js"
import { Media } from "../media.js"
import type { AuthInput } from "./auth.js"
import {
  AIError,
  ContentPolicyError,
  HttpContext,
  InvalidProviderOutputError,
  InvalidRequestError,
  ProviderID,
  ProviderInternalError,
  UnsupportedOperationError,
} from "../schema/index.js"

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/** Array values become repeated parameters (`keyterm=a&keyterm=b`). */
export type Query = Readonly<Record<string, string | ReadonlyArray<string>>>

/** `query` is appended to the endpoint URL before the route and caller `http.query` overlays. */
export type Body =
  | { readonly type: "json"; readonly value: Record<string, unknown>; readonly query?: Query }
  | { readonly type: "multipart"; readonly value: FormData }
  | {
      readonly type: "binary"
      readonly value: Uint8Array
      readonly contentType: string
      readonly query?: Query
    }

export const json = (value: Record<string, unknown>, query?: Query): Body => ({
  type: "json",
  value,
  query,
})
export const multipart = (value: FormData): Body => ({ type: "multipart", value })
export const binary = (value: Uint8Array, contentType: string, query?: Query): Body => ({
  type: "binary",
  value,
  contentType,
  query,
})

export type Send = (path: string, body: Body) => Effect.Effect<HttpClientResponse.HttpClientResponse, AIError>

/** Runs after unsupported-field rejection and before `body.from`, for providers that need an upload first. */
export type Prepare<Request> = (request: Request, send: Send) => Effect.Effect<Request, AIError>

// ---------------------------------------------------------------------------
// Protocol kinds
// ---------------------------------------------------------------------------

export interface DecodeContext<Request> {
  readonly request: Request
  readonly body: Body
}

/** One request, one response. JSON or multipart in; JSON or raw bytes out. */
export interface Inline<Request, Response> {
  readonly kind: "inline"
  readonly id: string
  readonly provider: ProviderID
  /** Common request fields this protocol cannot lower; the route rejects them before `body.from` runs. */
  readonly unsupported?: ReadonlyArray<keyof Request & string>
  readonly body: { readonly from: (request: Request) => Effect.Effect<Body, AIError> }
  readonly response: {
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: DecodeContext<Request>,
    ) => Effect.Effect<Response, AIError>
  }
}

export const inline = <Request, Response>(
  route: Identity,
  input: Omit<Inline<Request, Response>, "kind" | "id" | "provider">,
): Inline<Request, Response> => ({ kind: "inline", id: route.id, provider: route.provider, ...input })

/** What `start` learned from the submission response: the route-owned handle plus the first observation. */
export interface Started<Token> {
  readonly token: Token
  readonly snapshot: Snapshot
}

/**
 * A follow-up call's inputs: the decoded token and the auth headers the route sent, so a protocol can attach them
 * to output URLs that require the same credentials to download (Veo). `materialize` downloads an output through the
 * route's executor, for URLs that expire too soon to hand back (BFL).
 */
export interface PollContext<Token> {
  readonly token: Token
  readonly auth: Record<string, string>
  readonly materialize: (asset: Media.Asset) => Effect.Effect<Media.Asset, AIError>
}

/**
 * Submit, then poll. `start` posts the body to the route endpoint; `status`, `result`, and `cancel` are follow-up
 * calls addressed by the token. Paths are relative to the route base URL unless the provider hands back absolute
 * URLs (fal `status_url`), in which case they are used verbatim. `result` is always its own GET: providers that
 * return the output inside the status body (Veo, xAI, Runway) point `result.path` at the status path and decode the
 * same document, so `Generation.await` and `Video.resume(...).await()` behave identically everywhere.
 */
export interface Queued<Request, Response, Token> {
  readonly kind: "queued"
  readonly id: string
  readonly provider: ProviderID
  /** Common request fields this protocol cannot lower; the route rejects them before `start.body.from` runs. */
  readonly unsupported?: ReadonlyArray<keyof Request & string>
  /** Serializable handle. `Generation.token` carries the encoded form so it can be persisted and resumed elsewhere. */
  readonly token: Schema.Codec<Token, unknown>
  readonly start: {
    readonly prepare?: Prepare<Request>
    readonly body: { readonly from: (request: Request) => Effect.Effect<Body, AIError> }
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: DecodeContext<Request>,
    ) => Effect.Effect<Started<Token>, AIError>
  }
  readonly status: {
    readonly path: (token: Token) => string
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: PollContext<Token>,
    ) => Effect.Effect<Snapshot, AIError>
  }
  readonly result: {
    readonly path: (token: Token) => string
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: PollContext<Token>,
    ) => Effect.Effect<Response, AIError>
  }
  readonly cancel?: {
    readonly method: AuthInput["method"]
    readonly path: (token: Token) => string
    /**
     * Fetch a fresh status first and skip the call for terminal generations, for providers whose cancel endpoint
     * destroys finished work (Runway's `DELETE /v1/tasks/{id}` deletes completed tasks and their outputs).
     */
    readonly activeOnly?: boolean
  }
}

export const queued = <Request, Response, Token>(
  route: Identity,
  input: Omit<Queued<Request, Response, Token>, "kind" | "id" | "provider">,
): Queued<Request, Response, Token> => ({ kind: "queued", id: route.id, provider: route.provider, ...input })

export type Mode = "generate" | "stream"

export type Addressed<Request> = Request & { readonly mode: Mode }

export interface ResponseContext<Request> extends DecodeContext<Addressed<Request>> {
  readonly http: HttpContext
}

/**
 * One request whose body is parsed incrementally, like LLM protocols: `frames` → `step`* → `finish`. `generate` and
 * `stream` share this state machine; `request.mode` lets a protocol pick a different body, path, or framing.
 */
export interface Streamed<Request, Event, Frame, State> {
  readonly kind: "stream"
  readonly id: string
  readonly provider: ProviderID
  /** Common request fields this protocol cannot lower; the route rejects them before `body.from` runs. */
  readonly unsupported?: ReadonlyArray<keyof Request & string>
  readonly body: { readonly from: (request: Addressed<Request>) => Effect.Effect<Body, AIError> }
  readonly frames: (
    bytes: Stream.Stream<Uint8Array, AIError>,
    context: DecodeContext<Addressed<Request>>,
  ) => Stream.Stream<Frame, AIError>
  readonly initial: () => State
  readonly step: (state: State, frame: Frame) => Effect.Effect<readonly [State, ReadonlyArray<Event>], AIError>
  /** Emit exactly one terminal event, or fail when the provider stopped before completing. */
  readonly finish: (state: State, context: ResponseContext<Request>) => Effect.Effect<ReadonlyArray<Event>, AIError>
}

export const stream = <Request, Event, Frame, State>(
  route: Identity,
  input: Omit<Streamed<Request, Event, Frame, State>, "kind" | "id" | "provider">,
): Streamed<Request, Event, Frame, State> => ({ kind: "stream", id: route.id, provider: route.provider, ...input })

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const context = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({ url: response.request.url, status: response.status, headers: response.headers })

/** One protocol's route id, display name, and provider, with the decoders and errors that carry them. */
export const identity = (input: { readonly id: string; readonly name: string; readonly provider: string }) => {
  const provider = ProviderID.make(input.provider)
  const frameError = (message: string, body?: string, cause?: unknown) =>
    new AIError({ reason: new InvalidProviderOutputError({ route: input.id, message, body, cause }) })

  /**
   * Read a text body while retaining the original payload and HTTP context on every downstream error. `invalid` is a
   * malformed provider document; `ended` is a generation that reached a terminal status without output (`failed` is
   * provider-side, `cancelled`/`expired` mean the result will never exist); `pending` is a `result()` read before the
   * generation finished, which is caller misuse; `contentPolicy` is a moderated result.
   */
  const text = Effect.fn("MediaProtocol.text")(function* (response: HttpClientResponse.HttpClientResponse) {
    const http = context(response)
    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new AIError({
            reason: new InvalidProviderOutputError({
              route: input.id,
              message: `Failed to read the ${input.name} response`,
              http,
              cause,
            }),
          }),
      ),
    )
    return {
      body,
      http,
      invalid: (message: string, cause?: unknown) =>
        new AIError({ reason: new InvalidProviderOutputError({ route: input.id, message, body, http, cause }) }),
      ended: (status: Exclude<Status, "queued" | "running" | "completed">, message: string) =>
        new AIError({
          reason:
            status === "failed"
              ? new ProviderInternalError({ message, body, http })
              : new InvalidRequestError({ message, body, http }),
        }),
      pending: (id: string) =>
        new AIError({
          reason: new InvalidRequestError({
            message: `${input.name} generation ${id} has not finished; await it before reading the result`,
            body,
            http,
          }),
        }),
      contentPolicy: (message: string) => new AIError({ reason: new ContentPolicyError({ message, body, http }) }),
    }
  })

  /** Read and Schema-decode a JSON body. Decode failures keep the raw body as `reason.body`. */
  const decodeJson = <A>(schema: Schema.Codec<A, unknown>) => {
    const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
    return Effect.fn("MediaProtocol.decodeJson")(function* (response: HttpClientResponse.HttpClientResponse) {
      const output = yield* text(response)
      const value = yield* decode(output.body).pipe(
        Effect.mapError((cause) => output.invalid(`${input.name} returned an invalid response`, cause)),
      )
      return { ...output, value }
    })
  }

  return {
    id: input.id,
    name: input.name,
    provider,
    text,
    decodeJson,
    /** Decode a submission response into the token and first snapshot. */
    decodeStarted: <A, Token>(schema: Schema.Codec<A, unknown>, started: (value: A) => Started<Token>) => {
      const decode = decodeJson(schema)
      return (response: HttpClientResponse.HttpClientResponse) =>
        decode(response).pipe(Effect.map((output) => started(output.value)))
    },
    /** Schema-decode one JSON stream frame. Decode failures keep the frame as `reason.body`. */
    decodeFrame: <A>(schema: Schema.Codec<A, unknown>) => {
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
      return (frame: string) =>
        decode(frame).pipe(
          Effect.mapError((cause) => frameError(`${input.name} sent an invalid stream event`, frame, cause)),
        )
    },
    /** A stream-time failure; the frame stays on `reason.body`. */
    frameError,
    incomplete: () =>
      new AIError({
        reason: new InvalidProviderOutputError({
          route: input.id,
          message: "The provider response ended unexpectedly.",
          classification: "incomplete-stream",
        }),
      }),
    unsupported: (operation: string, message: string) =>
      new AIError({ reason: new UnsupportedOperationError({ operation, provider, route: input.id, message }) }),
  }
}

export type Identity = ReturnType<typeof identity>

export type Output = Effect.Success<ReturnType<Identity["text"]>>

/** Map a provider status string through the protocol's table; unknown values are an invalid provider document. */
export const status = <Table extends Record<string, Status>>(
  table: Table,
  raw: string,
  output: Output,
): Effect.Effect<Status, AIError> => {
  if (!Object.hasOwn(table, raw)) return Effect.fail(output.invalid(`Unknown generation status "${raw}"`))
  return Effect.succeed(table[raw])
}

/** A `url` asset whose provider-declared retention window starts now. */
export const expiringUrl = (url: string, retention: Duration.Duration, options?: Parameters<typeof Media.url>[1]) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => Media.url(url, { ...options, expiresAt: now + Duration.toMillis(retention) })),
  )

export * as MediaProtocol from "./media-protocol.js"
