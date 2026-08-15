import { ClientApi } from "@opencode-ai/client/contract"
import { Tool } from "@opencode-ai/schema/tool"
import { DateTime, Effect, Schema, SchemaAST, Scope, Stream } from "effect"
import type { Brand } from "effect/Brand"
import { HttpApiSchema } from "effect/unstable/httpapi"
import { define } from "../effect/plugin.js"
import type { Context, Plugin } from "./plugin.js"
import type { Info } from "./tool.js"

type HostRegistration = { readonly dispose: Effect.Effect<void> }
type Registration = { readonly dispose: () => Promise<void> }
type PromiseEvent = ReturnType<Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never
type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

const AgentEndpoints = ClientApi.groups["server.agent"].endpoints
const CommandEndpoints = ClientApi.groups["server.command"].endpoints
const IntegrationEndpoints = ClientApi.groups["server.integration"].endpoints
const ModelEndpoints = ClientApi.groups["server.model"].endpoints
const PluginEndpoints = ClientApi.groups["server.plugin"].endpoints
const ProviderEndpoints = ClientApi.groups["server.provider"].endpoints
const ReferenceEndpoints = ClientApi.groups["server.reference"].endpoints
const SessionEndpoints = ClientApi.groups["server.session"].endpoints
const SkillEndpoints = ClientApi.groups["server.skill"].endpoints
const WebSearchEndpoints = ClientApi.groups["server.websearch"].endpoints

/**
 * Adapts a Promise plugin into an Effect plugin so the existing Effect-only
 * loader (`Plugin` / `PluginSupervisor`) can run it unchanged.
 *
 * Hook registrations created during the async `setup` attach to the plugin's
 * scope, so unloading the plugin disposes them. The captured fiber context
 * preserves boot-time batching, so Promise-plugin transforms still coalesce
 * into one reload per domain.
 */
export function fromPromise(plugin: Plugin) {
  return define({
    id: plugin.id,
    effect: (host) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const context = yield* Effect.context<Scope.Scope>()

        // Run a hook registration on the plugin scope and resolve once it is registered.
        const register = (effect: Effect.Effect<HostRegistration, never, Scope.Scope>): Promise<Registration> =>
          Effect.runPromiseWith(context)(Scope.provide(scope)(effect)).then((registration) => ({
            dispose: () => Effect.runPromiseWith(context)(registration.dispose),
          }))

        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect).then(wire)

        const adaptApiMethod = <Method extends (input: never) => Effect.Effect<unknown, unknown>>(
          endpoint: ApiEndpoint,
          method: Method,
        ) => {
          const payloadSchemas = Array.from(endpoint.payload.values()).flatMap(({ schemas }) => schemas)
          const successSchemas = Array.from(endpoint.success)
          if (payloadSchemas.length > 1 || successSchemas.length > 1) {
            throw new Error(`Unsupported API schema cardinality: ${endpoint.identifier}`)
          }
          const inputs = [
            endpoint.params,
            endpoint.query === undefined ? undefined : Schema.toType(endpoint.query),
            endpoint.headers,
            ...payloadSchemas,
          ].filter((schema): schema is Schema.Top => schema !== undefined) as Array<RuntimeSchema>
          const success = (successSchemas[0] ?? HttpApiSchema.NoContent) as RuntimeSchema
          const noContent = HttpApiSchema.isNoContent(success.ast)
          const type = Schema.toType(success).ast
          const data = SchemaAST.isObjects(success.ast)
            ? success.ast.propertySignatures.find((property) => property.name === "data")
            : undefined
          const output =
            !noContent &&
            SchemaAST.isObjects(type) &&
            type.indexSignatures.length === 0 &&
            type.propertySignatures.length === 1 &&
            type.propertySignatures[0]?.name === "data" &&
            data !== undefined
              ? (Schema.make<Schema.Top>(data.type) as RuntimeSchema)
              : success

          return (input?: PromiseInput<Parameters<Method>[0]>) =>
            Effect.gen(function* () {
              const decoded = yield* Effect.forEach(inputs, (schema) => Schema.decodeUnknownEffect(schema)(input ?? {}))
              const result = yield* method(Object.assign({}, ...decoded) as never)
              if (noContent) return undefined
              return yield* Schema.encodeUnknownEffect(output)(result)
            }).pipe(Effect.runPromiseWith(context)) as Promise<Wire<EffectOutput<Method>>>
        }

        const transform =
          <Draft>(domain: {
            transform: (callback: (draft: Draft) => void) => Effect.Effect<HostRegistration, never, Scope.Scope>
          }) =>
          (callback: (draft: Draft) => void) =>
            register(
              domain.transform((draft) => {
                callback(draft)
              }),
            )

        const context2: Context = {
          app: host.app,
          options: host.options,
          agent: {
            get: adaptApiMethod(AgentEndpoints["agent.get"], host.agent.get),
            list: adaptApiMethod(AgentEndpoints["agent.list"], host.agent.list),
            transform: transform(host.agent),
            reload: () => run(host.agent.reload()),
          },
          aisdk: {
            hook: (name, callback) =>
              register(host.aisdk.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          catalog: {
            provider: {
              list: adaptApiMethod(ProviderEndpoints["provider.list"], host.catalog.provider.list),
              get: adaptApiMethod(ProviderEndpoints["provider.get"], host.catalog.provider.get),
            },
            model: {
              list: adaptApiMethod(ModelEndpoints["model.list"], host.catalog.model.list),
              default: adaptApiMethod(ModelEndpoints["model.default"], host.catalog.model.default),
            },
            transform: transform(host.catalog),
            reload: () => run(host.catalog.reload()),
          },
          command: {
            list: adaptApiMethod(CommandEndpoints["command.list"], host.command.list),
            transform: transform(host.command),
            reload: () => run(host.command.reload()),
          },
          event: {
            subscribe: () => Stream.toAsyncIterable(host.event.subscribe().pipe(Stream.map(wireEvent))),
          },
          integration: {
            list: adaptApiMethod(IntegrationEndpoints["integration.list"], host.integration.list),
            get: adaptApiMethod(IntegrationEndpoints["integration.get"], host.integration.get),
            connect: {
              key: adaptApiMethod(IntegrationEndpoints["integration.connect.key"], host.integration.connect.key),
            },
            oauth: {
              connect: adaptApiMethod(
                IntegrationEndpoints["integration.oauth.connect"],
                host.integration.oauth.connect,
              ),
              status: adaptApiMethod(IntegrationEndpoints["integration.oauth.status"], host.integration.oauth.status),
              complete: adaptApiMethod(
                IntegrationEndpoints["integration.oauth.complete"],
                host.integration.oauth.complete,
              ),
              cancel: adaptApiMethod(IntegrationEndpoints["integration.oauth.cancel"], host.integration.oauth.cancel),
            },
            command: {
              connect: adaptApiMethod(
                IntegrationEndpoints["integration.command.connect"],
                host.integration.command.connect,
              ),
              status: adaptApiMethod(
                IntegrationEndpoints["integration.command.status"],
                host.integration.command.status,
              ),
              cancel: adaptApiMethod(
                IntegrationEndpoints["integration.command.cancel"],
                host.integration.command.cancel,
              ),
            },
            transform: (callback) =>
              register(
                host.integration.transform((draft) =>
                  callback({
                    list: draft.list,
                    get: draft.get,
                    update: draft.update,
                    remove: draft.remove,
                    method: {
                      list: draft.method.list,
                      update: (input) => {
                        if (!("authorize" in input)) return draft.method.update(input)
                        const refresh = input.refresh
                        draft.method.update({
                          ...input,
                          authorize: (answer) =>
                            Effect.promise(() => input.authorize(answer)).pipe(
                              Effect.map((authorization) =>
                                authorization.mode === "auto"
                                  ? {
                                      ...authorization,
                                      callback: Effect.promise(() => authorization.callback),
                                    }
                                  : {
                                      ...authorization,
                                      callback: (code) => Effect.promise(() => authorization.callback(code)),
                                    },
                              ),
                            ),
                          refresh:
                            refresh === undefined
                              ? undefined
                              : (credential) => Effect.promise(() => refresh(credential)),
                        })
                      },
                      remove: draft.method.remove,
                    },
                  }),
                ),
              ),
            reload: () => run(host.integration.reload()),
            connection: {
              active: (id) => Effect.runPromiseWith(context)(host.integration.connection.active(id)),
              resolve: (connection) => Effect.runPromiseWith(context)(host.integration.connection.resolve(connection)),
            },
          },
          plugin: {
            list: adaptApiMethod(PluginEndpoints["plugin.list"], host.plugin.list),
          },
          reference: {
            list: adaptApiMethod(ReferenceEndpoints["reference.list"], host.reference.list),
            transform: transform(host.reference),
            reload: () => run(host.reference.reload()),
          },
          skill: {
            list: adaptApiMethod(SkillEndpoints["skill.list"], host.skill.list),
            transform: transform(host.skill),
            reload: () => run(host.skill.reload()),
          },
          tool: {
            transform: (callback) =>
              register(
                host.tool.transform((draft) =>
                  callback({
                    add: (tool: Info) =>
                      draft.add({
                        ...tool,
                        execute: (input, context) => executePromiseTool(tool, input, context),
                      }),
                  }),
                ),
              ),
            hook: (name, callback) =>
              register(host.tool.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          websearch: {
            providers: adaptApiMethod(WebSearchEndpoints["websearch.providers"], host.websearch.providers),
            query: adaptApiMethod(WebSearchEndpoints["websearch.query"], host.websearch.query),
            reload: () => run(host.websearch.reload()),
            transform: (callback) =>
              register(
                host.websearch.transform((draft) => {
                  callback({
                    add: (definition) =>
                      draft.add({
                        id: definition.id,
                        name: definition.name,
                        execute: (input) => attempt((signal) => definition.execute(input, { signal })),
                      }),
                    default: draft.default,
                  })
                }),
              ),
          },
          session: {
            hook: (name, callback) =>
              register(host.session.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
            create: adaptApiMethod(SessionEndpoints["session.create"], host.session.create),
            get: adaptApiMethod(SessionEndpoints["session.get"], host.session.get),
            prompt: adaptApiMethod(SessionEndpoints["session.prompt"], host.session.prompt),
            generate: adaptApiMethod(SessionEndpoints["session.generate"], host.session.generate),
            command: adaptApiMethod(SessionEndpoints["session.command"], host.session.command),
            synthetic: adaptApiMethod(SessionEndpoints["session.synthetic"], host.session.synthetic),
            interrupt: adaptApiMethod(SessionEndpoints["session.interrupt"], host.session.interrupt),
          },
          shell: {
            hook: (name, callback) =>
              register(host.shell.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
        }

        const cleanup = yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
        if (!cleanup) return
        yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())))
      }),
  })
}

function attempt<A>(evaluate: (signal: AbortSignal) => PromiseLike<A>) {
  return Effect.tryPromise({ try: evaluate, catch: (cause) => cause })
}

interface ApiEndpoint {
  readonly identifier: string
  readonly params: Schema.Top | undefined
  readonly query: Schema.Top | undefined
  readonly headers: Schema.Top | undefined
  readonly payload: ReadonlyMap<string, { readonly schemas: ReadonlyArray<Schema.Top> }>
  readonly success: ReadonlySet<Schema.Top>
}

type RuntimeSchema = Schema.Codec<unknown, unknown>

type PromiseInput<Value> = Value extends object
  ? {
      [Key in keyof Value]: undefined extends Value[Key]
        ? InputWire<Exclude<Value[Key], undefined>> | null
        : InputWire<Value[Key]>
    }
  : InputWire<Value>

type EffectOutput<Method> = Method extends (input: never) => Effect.Effect<infer Output, unknown> ? Output : never

type InputWire<Value> = unknown extends Value
  ? JsonValue
  : Value extends Brand<string>
    ? InputWire<Brand.Unbranded<Value>>
    : Value extends string | number | boolean | bigint | symbol | null | undefined
      ? Value
      : Value extends DateTime.DateTime
        ? number
        : Value extends readonly [infer Head, ...infer Tail]
          ? readonly [InputWire<Head>, ...InputWireTuple<Tail>]
          : Value extends ReadonlyArray<infer Item>
            ? ReadonlyArray<InputWire<Item>>
            : Value extends object
              ? { readonly [Key in keyof Value]: InputWire<Value[Key]> }
              : Value

type InputWireTuple<Value extends ReadonlyArray<unknown>> = {
  readonly [Key in keyof Value]: InputWire<Value[Key]>
}

type Wire<Value> = unknown extends Value
  ? JsonValue
  : Value extends Brand<string>
    ? Wire<Brand.Unbranded<Value>>
    : Value extends string | number | boolean | bigint | symbol | null | undefined
      ? Value
      : Value extends DateTime.DateTime
        ? number
        : Value extends readonly [infer Head, ...infer Tail]
          ? [Wire<Head>, ...WireTuple<Tail>]
          : Value extends ReadonlyArray<infer Item>
            ? Array<Wire<Item>>
            : Value extends object
              ? {
                  -readonly [Key in keyof Value]: {} extends Pick<Value, Key>
                    ? Wire<Value[Key]>
                    : undefined extends Value[Key]
                      ? Wire<Exclude<Value[Key], undefined>> | null
                      : Wire<Value[Key]>
                }
              : Value

type WireTuple<Value extends ReadonlyArray<unknown>> = {
  -readonly [Key in keyof Value]: Wire<Value[Key]>
}

function wire<Value>(value: Value): Wire<Value>
function wire(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(wire)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]))
}

function wireEvent(value: unknown): PromiseEvent
function wireEvent(value: unknown): unknown {
  return wire(value)
}

const executePromiseTool = (tool: Info, input: any, context: Tool.Context) =>
  Effect.promise(() =>
    tool.execute(input, {
      ...context,
      progress: (update) => Effect.runPromise(context.progress(update)),
    }),
  )
