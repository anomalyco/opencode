import type { Effect } from "effect"
import { Capabilities } from "./capabilities.js"
import type { CompactionOperations } from "./route/client.js"
import type { EndpointPart } from "./route/endpoint.js"
import type { Framing } from "./route/framing.js"
import type { Protocol } from "./route/protocol.js"
import { HttpTransport, type Transport } from "./route/transport/index.js"
import { mergeRequestOptions, type AIError, type LLMRequest, type RequestOptions } from "./schema/index.js"

/**
 * A request format: how a common request becomes a body, how the response stream decodes, and the wire rules
 * every host of the format shares (path, fixed headers, request defaults, compaction). An API never sees
 * credentials; providers list the APIs they serve and `configure` says what a host does differently.
 */
export interface Definition<
  Name extends string = string,
  Caps extends Capabilities.Any = Capabilities.Any,
  Compact extends CompactionOperations | undefined = CompactionOperations | undefined,
  Body = unknown,
> {
  /** Selects the API on a provider: `provider.model(id, { api: "chat-completions" })`. Dialects keep their parent's. */
  readonly name: Name
  /** This implementation, for diagnostics. A dialect has its own. */
  readonly id: string
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
  /** What every model on this API supports unless the host or caller says otherwise. */
  readonly capabilities?: Caps
  readonly compact: Compact
  /** What one provider's host does differently. Set with `configure`. */
  readonly host: Host<Caps>
  /** The same API as one host serves it. Each call replaces the fields it names. */
  readonly configure: (host: Host<Caps>) => Definition<Name, Caps, Compact, Body>
  /** A dialect: the same API with a new id and any pieces replaced. Everything else is inherited. */
  readonly extend: <NextName extends string = Name>(
    patch: Extend<NextName, Caps, Body>,
  ) => Definition<NextName, Caps, Compact, Body>
}

// Provider lists erase the body type once an API is built.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyApi = Definition<string, any, CompactionOperations | undefined, any>

export type CapabilitiesOf<A extends AnyApi> = NonNullable<A["capabilities"]>

export type CompactOf<A> = A extends { readonly compact: infer Compact extends CompactionOperations | undefined }
  ? Compact
  : CompactionOperations | undefined

/** Capabilities by model ID: `*` glob patterns matched case-insensitively and merged in order, or a function. */
export type Models<Caps> = Readonly<Record<string, Caps>> | ((modelID: string) => Caps | undefined)

export interface Host<Caps> {
  /** Overrides the provider's base URL for this API. */
  readonly baseURL?: string
  readonly query?: Record<string, string>
  /** `providerMetadata` namespace. Defaults to the provider id. */
  readonly metadataKey?: string
  /** Request options every model on this host starts from, over the API's, or a function of the model ID. */
  readonly options?: RequestOptions | ((modelID: string) => RequestOptions | undefined)
  /** True for every model on this host. Wins over `models`. */
  readonly capabilities?: Caps
  /** True for some models on this host, by model ID. */
  readonly models?: Models<Caps>
}

export type MakeInput<Name extends string, Caps, Compact, Body, Frame, Event, State> = {
  readonly name: Name
  /** Defaults to `name`. */
  readonly id?: string
  readonly protocol: Protocol<Body, Frame, Event, State>
  readonly path: EndpointPart<Body>
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  readonly options?: RequestOptions
  readonly capabilities?: Caps
  readonly compact?: Compact
} & // oxlint-disable-next-line typescript-eslint/no-explicit-any
(| { readonly transport: Transport<Body, any, Frame>; readonly framing?: never }
  | { readonly framing: Framing.Definition<Frame>; readonly transport?: never }
)

export interface Extend<Name extends string, Caps, Body> {
  readonly id: string
  /** Defaults to the parent's name. */
  readonly name?: Name
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
  const Name extends string,
  Caps extends Capabilities.Any = Capabilities.Any,
  Compact extends CompactionOperations | undefined = undefined,
  Body = unknown,
  Frame = unknown,
  Event = unknown,
  State = unknown,
>(
  input: MakeInput<Name, Caps, Compact, Body, Frame, Event, State>,
): Definition<Name, Caps, Compact, Body> =>
  build({
    name: input.name,
    id: input.id ?? input.name,
    protocol: input.protocol,
    transport: input.transport ?? HttpTransport.httpJson({ framing: input.framing! }),
    path: input.path,
    headers: input.headers,
    options: mergeRequestOptions(input.options),
    capabilities: input.capabilities,
    compact: input.compact as Compact,
    host: {},
  })

const build = <
  Name extends string,
  Caps extends Capabilities.Any,
  Compact extends CompactionOperations | undefined,
  Body,
>(
  definition: Omit<Definition<Name, Caps, Compact, Body>, "extend" | "configure">,
): Definition<Name, Caps, Compact, Body> => ({
  ...definition,
  configure: (host) => build({ ...definition, host: { ...definition.host, ...host } }),
  extend: <NextName extends string = Name>(patch: Extend<NextName, Caps, Body>) =>
    build<NextName, Caps, Compact, Body>({
      ...definition,
      name: (patch.name ?? definition.name) as NextName,
      id: patch.id,
      // A new body builder is a new codec; otherwise the dialect speaks its parent's.
      protocol: patch.body
        ? {
            ...definition.protocol,
            id: patch.id,
            body: { ...definition.protocol.body, from: (request) => patch.body!(request, definition.protocol.body.from) },
          }
        : definition.protocol,
      path: patch.path ?? definition.path,
      headers: patch.headers ?? definition.headers,
      options: mergeRequestOptions(definition.options, patch.options),
      capabilities: Capabilities.merge(definition.capabilities, patch.capabilities),
    }),
})

/** The capabilities `models` gives a model ID. */
export const modelCapabilities = <Caps extends Capabilities.Any>(
  models: Models<Caps> | undefined,
  modelID: string,
): Caps | undefined => {
  if (models === undefined) return undefined
  if (typeof models === "function") return models(modelID)
  const id = modelID.toLowerCase()
  return Capabilities.merge(
    ...Object.entries(models).flatMap(([pattern, caps]) => (glob(pattern).test(id) ? [caps] : [])),
  )
}

const glob = (pattern: string) =>
  new RegExp(`^${pattern.toLowerCase().split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)

export * as Api from "./api.js"
