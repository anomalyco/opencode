import type { Effect } from "effect"
import { Capabilities } from "./capabilities.js"
import type { Auth } from "./route/auth.js"
import { Route, type AnyRoute, type CompactionOperations } from "./route/client.js"
import type { EndpointPart } from "./route/endpoint.js"
import type { Framing } from "./route/framing.js"
import type { Protocol } from "./route/protocol.js"
import { HttpTransport, type Transport } from "./route/transport/index.js"
import { mergeRequestOptions, type AIError, type LLMRequest, type RequestOptions } from "./schema/index.js"

/**
 * A request format: how a common request becomes a body, how the response stream decodes, and the wire rules
 * every host of the format shares (path, fixed headers, request defaults, compaction). An API never sees URLs,
 * credentials or model IDs; providers bind it to a host with `at`.
 */
export interface Definition<
  Id extends string = string,
  Caps extends Capabilities.Any = Capabilities.Any,
  Compact extends CompactionOperations | undefined = CompactionOperations | undefined,
  Body = unknown,
> {
  readonly id: Id
  // Frames, events and parser state are internal to the codec and erased once the API is built.
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  readonly protocol: Protocol<Body, any, any, any>
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  readonly transport: Transport<Body, any, any>
  readonly path: EndpointPart<Body>
  /** Wire headers every request on this API sends, such as a version pin. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Request options every model on this API starts from. */
  readonly options?: RequestOptions
  /** What every model on this API supports unless a provider or caller says otherwise. */
  readonly capabilities?: Caps
  readonly compact: Compact
  /** A dialect: the same API with a different id and any pieces replaced. Everything else is inherited. */
  readonly extend: <NextId extends string>(patch: Extend<NextId, Caps, Body>) => Definition<NextId, Caps, Compact, Body>
  /** This API served at a base URL. */
  readonly at: (baseURL: string, options?: BindingOptions<Caps>) => Binding<Definition<Id, Caps, Compact, Body>>
}

// Registries erase the body type once an API is built.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyApi = Definition<string, any, CompactionOperations | undefined, any>

export type CapabilitiesOf<A extends AnyApi> = NonNullable<A["capabilities"]>
export type CompactOf<A> = A extends { readonly compact: infer Compact extends CompactionOperations | undefined }
  ? Compact
  : CompactionOperations | undefined

export type MakeInput<Id extends string, Caps, Compact, Body, Frame, Event, State> = {
  readonly id: Id
  readonly protocol: Protocol<Body, Frame, Event, State>
  readonly path: EndpointPart<Body>
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  readonly options?: RequestOptions
  readonly capabilities?: Caps
  readonly compact?: Compact
} &
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  (| { readonly transport: Transport<Body, any, Frame>; readonly framing?: never }
    | { readonly framing: Framing.Definition<Frame>; readonly transport?: never }
  )

export interface Extend<Id extends string, Caps, Body> {
  readonly id: Id
  /** Replace body construction. `base` is the parent's builder, so a dialect can adjust its output. */
  readonly body?: (
    request: LLMRequest,
    base: (request: LLMRequest) => Effect.Effect<Body, AIError>,
  ) => Effect.Effect<Body, AIError>
  readonly path?: EndpointPart<Body>
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Merged over the parent's request options. */
  readonly options?: RequestOptions
  /** Merged over the parent's capability defaults. */
  readonly capabilities?: Caps
}

export const make = <
  const Id extends string,
  Caps extends Capabilities.Any = Capabilities.Any,
  Compact extends CompactionOperations | undefined = undefined,
  Body = unknown,
  Frame = unknown,
  Event = unknown,
  State = unknown,
>(
  input: MakeInput<Id, Caps, Compact, Body, Frame, Event, State>,
): Definition<Id, Caps, Compact, Body> =>
  build({
    id: input.id,
    protocol: input.protocol,
    transport: input.transport ?? HttpTransport.httpJson({ framing: input.framing! }),
    path: input.path,
    headers: input.headers,
    options: mergeRequestOptions(input.options),
    capabilities: input.capabilities,
    compact: input.compact as Compact,
  })

const build = <
  Id extends string,
  Caps extends Capabilities.Any,
  Compact extends CompactionOperations | undefined,
  Body,
>(
  definition: Omit<Definition<Id, Caps, Compact, Body>, "extend" | "at">,
): Definition<Id, Caps, Compact, Body> => {
  const api: Definition<Id, Caps, Compact, Body> = {
    ...definition,
    extend: (patch) =>
      build({
        ...definition,
        id: patch.id,
        protocol: patch.body
          ? {
              ...definition.protocol,
              id: patch.id,
              body: {
                ...definition.protocol.body,
                from: (request) => patch.body!(request, definition.protocol.body.from),
              },
            }
          : { ...definition.protocol, id: patch.id },
        path: patch.path ?? definition.path,
        headers: patch.headers ?? definition.headers,
        options: mergeRequestOptions(definition.options, patch.options),
        capabilities: Capabilities.merge(definition.capabilities, patch.capabilities),
      }),
    at: (baseURL, options = {}) => ({ ...options, api, baseURL }),
  }
  return api
}

/** How a provider serves one API: where, and what it knows about models there. */
export interface BindingOptions<Caps> {
  /** Route id kept for diagnostics and prepared-request metadata. Defaults to the API id. */
  readonly id?: string
  /** `providerMetadata` namespace. Defaults to the provider id. */
  readonly metadataKey?: string
  readonly query?: Record<string, string>
  /** Request options every model on this host starts from, over the API's. */
  readonly options?: RequestOptions
  /** Facts that hold for every model on this host, over the API defaults and model-name guesses. */
  readonly capabilities?: Caps
  /** What this host is known to do for a model ID. Runs under `capabilities` and the caller's values. */
  readonly guess?: (modelID: string) => Guess<Caps> | undefined
  /** Turn off compaction mechanisms the host doesn't serve. */
  readonly compact?: false | { readonly endpoint?: false; readonly trigger?: false }
}

export interface Guess<Caps> {
  readonly capabilities?: Caps
  readonly options?: RequestOptions
}

export interface Binding<A extends AnyApi = AnyApi> extends BindingOptions<CapabilitiesOf<A>> {
  readonly api: A
  readonly baseURL: string
}

/**
 * The route the current request pipeline runs. `Provider.model` builds it; it disappears once the pipeline reads
 * APIs and bindings directly.
 */
export const route = <B extends Binding>(
  binding: B,
  input: {
    readonly provider: string
    readonly baseURL?: string
    readonly query?: Record<string, string>
    readonly auth?: Auth.Definition
    readonly options?: RequestOptions
  },
) => {
  const api = binding.api
  const query =
    binding.query === undefined && input.query === undefined ? undefined : { ...binding.query, ...input.query }
  return Route.make({
    id: binding.id ?? api.id,
    provider: input.provider,
    providerMetadataKey: binding.metadataKey ?? input.provider,
    protocol: api.protocol,
    endpoint: { baseURL: input.baseURL ?? binding.baseURL, path: api.path, ...(query === undefined ? {} : { query }) },
    auth: input.auth,
    headers: api.headers,
    transport: api.transport,
    options: mergeRequestOptions(api.options, binding.options, input.options),
    compact: compaction(api.compact, binding.compact),
  }) as AnyRoute<CompactOf<B["api"]>>
}

const compaction = (
  operations: CompactionOperations | undefined,
  narrow: BindingOptions<unknown>["compact"],
): CompactionOperations | undefined => {
  if (operations === undefined || narrow === undefined) return operations
  if (narrow === false) return undefined
  const endpoint = narrow.endpoint === false ? undefined : operations.endpoint
  const trigger = narrow.trigger === false ? undefined : operations.trigger
  if (endpoint === undefined && trigger === undefined) return undefined
  return { ...(endpoint ? { endpoint } : {}), ...(trigger ? { trigger } : {}) }
}

export * as Api from "./api.js"
