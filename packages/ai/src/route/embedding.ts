import { Effect } from "effect"
import type { HttpClientResponse } from "effect/http"
import {
  EmbeddingModel,
  EmbeddingResponse,
  EmbeddingUsage,
  type EmbeddingOptions,
  type EmbeddingRequest,
} from "../embedding.js"
import { ProviderID, type HttpOptions, type AIError, type ProviderOptions } from "../schema/index.js"
import { Auth } from "./auth.js"
import { Endpoint } from "./endpoint.js"
import { MediaProtocol } from "./media-protocol.js"
import { MediaRoute } from "./media.js"

/** One embedding API: how a request becomes its JSON body and how its response becomes an `EmbeddingResponse`. */
export interface Protocol {
  readonly id: string
  readonly name: string
  readonly body: { readonly from: (request: EmbeddingRequest) => Effect.Effect<Record<string, unknown>, AIError> }
  readonly response: {
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: { readonly request: EmbeddingRequest; readonly providerMetadataKey: string },
    ) => Effect.Effect<EmbeddingResponse, AIError>
  }
}

export const protocol = (input: Protocol) => input

export interface Patch {
  readonly id?: string
  readonly provider?: string | ProviderID
  /** ProviderMetadata namespace for responses; defaults to the provider. */
  readonly providerMetadataKey?: string
  readonly endpoint?: Endpoint.EndpointPatch<MediaProtocol.Body, EmbeddingRequest>
  readonly auth?: Auth.Definition
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
  /**
   * Most values one HTTP request may carry. Longer requests are split into requests of this size, sent a few at a
   * time, and joined back in value order.
   */
  readonly maxValues?: number
}

export interface Route {
  readonly id: string
  readonly provider: ProviderID
  readonly providerMetadataKey: string
  readonly protocol: Protocol
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, EmbeddingRequest>
  readonly auth: Auth.Definition
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
  readonly maxValues?: number
  readonly with: (patch: Patch) => Route
  readonly model: <Options extends EmbeddingOptions = EmbeddingOptions>(input: {
    readonly id: string
    readonly providerOptions?: ProviderOptions
  }) => EmbeddingModel<Options>
}

export interface MakeInput extends Omit<Patch, "endpoint"> {
  readonly id: string
  readonly provider: string | ProviderID
  readonly protocol: Protocol
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, EmbeddingRequest>
}

export const make = (input: MakeInput): Route => {
  const provider = ProviderID.make(input.provider)
  const route: Omit<Route, "with" | "model"> = {
    id: input.id,
    provider,
    providerMetadataKey: input.providerMetadataKey ?? provider,
    protocol: input.protocol,
    endpoint: input.endpoint,
    auth: input.auth ?? Auth.none,
    headers: input.headers,
    http: input.http,
    maxValues: input.maxValues,
  }
  return {
    ...route,
    with: (patch) =>
      make({
        ...route,
        ...patch,
        // A new provider gets its own metadata key unless the patch names one.
        providerMetadataKey:
          patch.providerMetadataKey ?? (patch.provider === undefined ? route.providerMetadataKey : undefined),
        endpoint: patch.endpoint === undefined ? route.endpoint : Endpoint.merge(route.endpoint, patch.endpoint),
        headers: patch.headers === undefined ? route.headers : { ...route.headers, ...patch.headers },
        http: patch.http ?? route.http,
        maxValues: patch.maxValues ?? route.maxValues,
      }),
    model: <Options extends EmbeddingOptions>(model: {
      readonly id: string
      readonly providerOptions?: ProviderOptions
    }) =>
      EmbeddingModel.make<Options>({
        id: model.id,
        provider,
        http: route.http,
        providerOptions: model.providerOptions,
        route: { id: route.id, generate: split(route.maxValues, transport(route).generate) },
      }),
  }
}

const CONCURRENCY = 4

/**
 * Splits a request whose values exceed `maxValues` and joins the parts: vectors in value order, `inputTokens` summed
 * when every part reports it, and each part's metadata in order under `providerMetadata[key].responses`.
 */
const split =
  (maxValues: number | undefined, generate: Generate): Generate =>
  (request, execute) => {
    if (maxValues === undefined || request.values.length <= maxValues) return generate(request, execute)
    const chunks = Array.from({ length: Math.ceil(request.values.length / maxValues) }, (_, index) =>
      request.values.slice(index * maxValues, (index + 1) * maxValues),
    )
    return Effect.forEach(chunks, (values) => generate({ ...request, values }, execute), {
      concurrency: CONCURRENCY,
    }).pipe(
      Effect.map((responses) => {
        const tokens = responses.map((response) => response.usage?.inputTokens)
        const keys = [...new Set(responses.flatMap((response) => Object.keys(response.providerMetadata ?? {})))]
        return new EmbeddingResponse({
          embeddings: responses.flatMap((response) => response.embeddings),
          usage: tokens.every((count) => count !== undefined)
            ? new EmbeddingUsage({ inputTokens: tokens.reduce((sum, count) => sum + count, 0) })
            : undefined,
          providerMetadata:
            keys.length === 0
              ? undefined
              : Object.fromEntries(
                  keys.map((key) => [
                    key,
                    { responses: responses.map((response) => response.providerMetadata?.[key] ?? {}) },
                  ]),
                ),
        })
      }),
    )
  }

type Generate = EmbeddingModel["route"]["generate"]

// The HTTP plumbing (URL, query, auth, headers, `http` overlays, surrogate sanitizing) is the one media routes use.
const transport = (route: Omit<Route, "with" | "model">) =>
  MediaRoute.inline({
    protocol: MediaProtocol.inline<EmbeddingRequest, EmbeddingResponse>(
      MediaProtocol.identity({ id: route.id, name: route.protocol.name, provider: route.provider }),
      {
        body: {
          from: (request) => route.protocol.body.from(request).pipe(Effect.map((body) => MediaProtocol.json(body))),
        },
        response: {
          decode: (response, context) =>
            route.protocol.response.decode(response, {
              request: context.request,
              providerMetadataKey: route.providerMetadataKey,
            }),
        },
      },
    ),
    endpoint: route.endpoint,
    auth: route.auth,
    headers: route.headers,
  })

export * as EmbeddingRoute from "./embedding.js"
