import { Effect } from "effect"
import type { HttpClientResponse } from "effect/http"
import { EmbeddingModel, type EmbeddingOptions, type EmbeddingRequest, type EmbeddingResponse } from "../embedding.js"
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
        route: { id: route.id, generate: transport(route).generate },
      }),
  }
}

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
