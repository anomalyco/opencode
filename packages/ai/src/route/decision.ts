import { Effect } from "effect"
import type { HttpClientResponse } from "effect/http"
import {
  DecisionModel,
  DecisionModelCompatibility,
  type DecisionOptions,
  type DecisionPart,
  type DecisionRequest,
  type DecisionResponse,
} from "../decision.js"
import {
  mergeTransport,
  ProviderID,
  type AIError,
  type ProviderOptions,
  type TransportOptions,
} from "../schema/index.js"
import { Auth } from "./auth.js"
import { Endpoint } from "./endpoint.js"
import { RequestExecutor } from "./executor.js"
import { MediaProtocol } from "./media-protocol.js"
import { MediaRoute, type Execute } from "./media.js"

/** One decision API: how a request becomes its JSON body and how its response becomes a `DecisionResponse`. */
export interface Protocol {
  readonly id: string
  readonly name: string
  /** The host only takes inline data, so URL media is downloaded before `body.from`. */
  readonly inlineMedia?: boolean
  readonly body: { readonly from: (request: DecisionRequest) => Effect.Effect<Record<string, unknown>, AIError> }
  readonly response: {
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: { readonly request: DecisionRequest; readonly providerMetadataKey: string },
    ) => Effect.Effect<DecisionResponse, AIError>
  }
}

export const protocol = (input: Protocol) => input

/** Headers, timeouts and `http` overlays merge into the route's; every model of the route starts from them. */
export interface Patch extends TransportOptions {
  readonly id?: string
  readonly provider?: string | ProviderID
  /** ProviderMetadata namespace for responses; defaults to the provider. */
  readonly providerMetadataKey?: string
  readonly endpoint?: Endpoint.EndpointPatch<MediaProtocol.Body, DecisionRequest>
  readonly auth?: Auth.Definition
}

export interface Route extends TransportOptions {
  readonly id: string
  readonly provider: ProviderID
  readonly providerMetadataKey: string
  readonly protocol: Protocol
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, DecisionRequest>
  readonly auth: Auth.Definition
  readonly with: (patch: Patch) => Route
  readonly model: <Options extends DecisionOptions = DecisionOptions>(input: {
    readonly id: string
    readonly compatibility?: DecisionModelCompatibility.Input
    readonly providerOptions?: ProviderOptions
  }) => DecisionModel<Options>
}

export interface MakeInput extends Omit<Patch, "endpoint"> {
  readonly id: string
  readonly provider: string | ProviderID
  readonly protocol: Protocol
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, DecisionRequest>
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
    ...mergeTransport(input),
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
        ...mergeTransport(route, patch),
      }),
    model: <Options extends DecisionOptions>(model: {
      readonly id: string
      readonly compatibility?: DecisionModelCompatibility.Input
      readonly providerOptions?: ProviderOptions
    }) => {
      const send = transport(route)
      return DecisionModel.make<Options>({
        id: model.id,
        provider,
        transport: mergeTransport(route),
        providerOptions: model.providerOptions,
        compatibility:
          model.compatibility === undefined ? undefined : DecisionModelCompatibility.make(model.compatibility),
        route: { id: route.id, generate: send },
      })
    },
  }
}

// The HTTP plumbing (URL, query, auth, headers, `http` overlays, surrogate sanitizing) is the one media routes use.
const transport = (route: Omit<Route, "with" | "model">) => {
  const identity = MediaProtocol.identity({ id: route.id, name: route.protocol.name, provider: route.provider })
  const composed = MediaRoute.inline({
    protocol: MediaProtocol.inline<DecisionRequest, DecisionResponse>(identity, {
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
    }),
    endpoint: route.endpoint,
    auth: route.auth,
  })
  return Effect.fnUntraced(function* (request: DecisionRequest, execute: Execute) {
    if (!route.protocol.inlineMedia) return yield* composed.generate(request, execute)
    const timed = RequestExecutor.withTimeout(execute, mergeTransport(request.model.transport, request).timeout)
    const input = yield* Effect.forEach(request.input, (part) => materialize(part, timed))
    return yield* composed.generate({ ...request, input }, execute)
  })
}

const materialize = (part: DecisionPart, execute: Execute) =>
  part.type === "media" && part.media.source.type === "url"
    ? part.media.materialize().pipe(
        Effect.provideService(RequestExecutor.Service, { execute }),
        Effect.map((media) => ({ ...part, media })),
      )
    : Effect.succeed(part)

export * as DecisionRoute from "./decision.js"
