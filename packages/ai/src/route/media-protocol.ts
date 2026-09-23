import { Effect, Schema } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { AIError, HttpContext, InvalidProviderOutputError } from "../schema/index.js"

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export type Body =
  | { readonly type: "json"; readonly value: Record<string, unknown> }
  | { readonly type: "multipart"; readonly value: FormData }

export const json = (value: Record<string, unknown>): Body => ({ type: "json", value })
export const multipart = (value: FormData): Body => ({ type: "multipart", value })

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
  readonly name: string
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
  input: Omit<Inline<Request, Response>, "kind">,
): Inline<Request, Response> => ({
  kind: "inline",
  ...input,
})

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const context = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({ url: response.request.url, status: response.status, headers: response.headers })

/** Read a text body while retaining the original payload and HTTP context on every downstream error. */
export const text = Effect.fn("MediaProtocol.text")(function* (
  route: string,
  name: string,
  response: HttpClientResponse.HttpClientResponse,
) {
  const http = context(response)
  const body = yield* response.text.pipe(
    Effect.mapError(
      (cause) =>
        new AIError({
          reason: new InvalidProviderOutputError({
            route,
            message: `Failed to read the ${name} response`,
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
      new AIError({ reason: new InvalidProviderOutputError({ route, message, body, http, cause }) }),
  }
})

/** Read and Schema-decode a JSON body. Decode failures keep the raw body as `reason.body`. */
export const decodeJson = <A>(route: string, name: string, schema: Schema.Codec<A, unknown>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
  return Effect.fn("MediaProtocol.decodeJson")(function* (response: HttpClientResponse.HttpClientResponse) {
    const output = yield* text(route, name, response)
    const value = yield* decode(output.body).pipe(
      Effect.mapError((cause) => output.invalid(`${name} returned an invalid response`, cause)),
    )
    return { ...output, value }
  })
}

export * as MediaProtocol from "./media-protocol.js"
