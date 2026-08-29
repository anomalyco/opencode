import { Tool } from "@opencode-ai/schema/tool"
import { Effect, Schema, SchemaAST, Stream } from "effect"
import type { Scope } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/unstable/httpapi"
import { define } from "../effect/plugin.js"
import type { Context, Plugin } from "./plugin.js"
import type { Info } from "./tool.js"

type HostRegistration = { readonly dispose: Effect.Effect<void> }
type Registration = { readonly dispose: () => Promise<void> }
type PromiseEvent = ReturnType<Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never

interface CompiledEndpoint {
  readonly decode: ReadonlyArray<(input: unknown) => Effect.Effect<unknown, Schema.SchemaError>>
  readonly encode: (output: unknown) => Effect.Effect<unknown, Schema.SchemaError>
  readonly noContent: boolean
}

const compiledEndpoints = new WeakMap<object, CompiledEndpoint>()

function compileEndpoint(endpoint: HttpApiEndpoint.Top) {
  const cached = compiledEndpoints.get(endpoint)
  if (cached) return cached
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
  const compiled = {
    decode: inputs.map((schema) => Schema.decodeUnknownEffect(schema)),
    encode: Schema.encodeUnknownEffect(output),
    noContent,
  } satisfies CompiledEndpoint
  compiledEndpoints.set(endpoint, compiled)
  return compiled
}

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
    tui: plugin.tui,
    vcs: plugin.vcs,
    effect: (host) =>
      Effect.gen(function* () {
        const [{ ClientApi }, { OpenCodeEvent }] = yield* Effect.promise(() =>
          Promise.all([import("@opencode-ai/protocol/client"), import("@opencode-ai/protocol/groups/event")]),
        )
        const AgentEndpoints = ClientApi.groups["server.agent"].endpoints
        const CommandEndpoints = ClientApi.groups["server.command"].endpoints
        const ExperimentalEndpoints = ClientApi.groups["server.experimental"].endpoints
        const GenerateEndpoints = ClientApi.groups["server.generate"].endpoints
        const IntegrationEndpoints = ClientApi.groups["server.integration"].endpoints
        const McpEndpoints = ClientApi.groups["server.mcp"].endpoints
        const ModelEndpoints = ClientApi.groups["server.model"].endpoints
        const PluginEndpoints = ClientApi.groups["server.plugin"].endpoints
        const PermissionEndpoints = ClientApi.groups["server.permission"].endpoints
        const ProviderEndpoints = ClientApi.groups["server.provider"].endpoints
        const ReferenceEndpoints = ClientApi.groups["server.reference"].endpoints
        const SessionEndpoints = ClientApi.groups["server.session"].endpoints
        const SkillEndpoints = ClientApi.groups["server.skill"].endpoints
        const VcsEndpoints = ClientApi.groups["server.vcs"].endpoints
        const WebSearchEndpoints = ClientApi.groups["server.websearch"].endpoints
        const context = yield* Effect.context<Scope.Scope>()

        // Run a hook registration on the plugin scope and resolve once it is registered.
        const register = (effect: Effect.Effect<HostRegistration, never, Scope.Scope>): Promise<Registration> =>
          Effect.runPromiseWith(context)(effect).then((registration) => ({
            dispose: () => Effect.runPromiseWith(context)(registration.dispose),
          }))

        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect)

        const promiseExecutor =
          (execute: Tool.Info["execute"]): Info["execute"] =>
          (input, context) =>
            run(
              execute(input, {
                ...context,
                progress: (update) => Effect.promise(() => context.progress(update)),
              }),
            )

        const adaptApiMethod = <PromiseMethod>(
          endpoint: HttpApiEndpoint.Top,
          method: (input: never) => Effect.Effect<unknown, unknown>,
        ) => {
          const compiled = compileEndpoint(endpoint)
          return ((input?: unknown) =>
            Effect.gen(function* () {
              const decoded = yield* Effect.forEach(compiled.decode, (decode) => decode(input ?? {}))
              const result = yield* method(Object.assign({}, ...decoded) as never)
              if (compiled.noContent) return undefined
              return yield* compiled.encode(result)
            }).pipe(Effect.runPromiseWith(context))) as PromiseMethod
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
          location: host.location,
          options: host.options,
          agent: {
            get: adaptApiMethod(AgentEndpoints["agent.get"], host.agent.get),
            list: adaptApiMethod(AgentEndpoints["agent.list"], host.agent.list),
            transform: transform(host.agent),
            reload: () => run(host.agent.reload()),
          },
          aisdk: {
            hook: (name, callback, options) =>
              register(
                host.aisdk.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))), options),
              ),
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
            transform: (callback) =>
              register(
                host.command.transform((draft) =>
                  callback({
                    add: (definition) =>
                      draft.add({
                        ...definition,
                        execute: (input) =>
                          Effect.tryPromise({ try: () => definition.execute(input), catch: (cause) => cause }),
                      }),
                  }),
                ),
              ),
            reload: () => run(host.command.reload()),
          },
          event: {
            subscribe: () =>
              Stream.toAsyncIterable(
                host.event.subscribe().pipe(
                  Stream.mapEffect((event) => Schema.encodeUnknownEffect(OpenCodeEvent)(event)),
                  Stream.map((event) => event as unknown as PromiseEvent),
                ),
              ),
          },
          experimental: {
            terminal: {
              read: adaptApiMethod(ExperimentalEndpoints["persistentPty.read"], host.experimental.terminal.read),
            },
          },
          generate: {
            text: adaptApiMethod(GenerateEndpoints["generate.text"], host.generate.text),
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
          mcp: {
            list: adaptApiMethod(McpEndpoints["mcp.list"], host.mcp.list),
            transform: transform(host.mcp),
            reload: () => run(host.mcp.reload()),
          },
          permission: {
            hook: (name, callback) =>
              register(host.permission.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
            list: adaptApiMethod(PermissionEndpoints["session.permission.list"], host.permission.list),
            get: adaptApiMethod(PermissionEndpoints["session.permission.get"], host.permission.get),
            reply: adaptApiMethod(PermissionEndpoints["session.permission.reply"], host.permission.reply),
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
          storage: {
            get: (key) => run(host.storage.get(key)),
            set: (key, value) => run(host.storage.set(key, value)),
            remove: (key) => run(host.storage.remove(key)),
            scan: (options) => run(host.storage.scan(options)),
          },
          tool: {
            reload: () => run(host.tool.reload()),
            transform: (callback) =>
              register(
                host.tool.transform((draft) =>
                  callback({
                    list: () => draft.list().map((tool) => ({ ...tool, execute: promiseExecutor(tool.execute) })),
                    get: (id) => {
                      const tool = draft.get(id)
                      return tool ? { ...tool, execute: promiseExecutor(tool.execute) } : undefined
                    },
                    add: (tool: Info) =>
                      draft.add({
                        ...tool,
                        execute: (input, context) => executePromiseTool(tool, input, context),
                      }),
                    update: (id, update) =>
                      draft.update(id, (tool) => {
                        const value: Info = {
                          ...tool,
                          execute: promiseExecutor(tool.execute),
                        }
                        update(value)
                        Object.assign(tool, value, {
                          output: value.output,
                          options: value.options,
                          execute: (input: Parameters<Info["execute"]>[0], context: Tool.Context) =>
                            executePromiseTool(value, input, context),
                        })
                      }),
                    remove: draft.remove,
                  }),
                ),
              ),
            hook: (name, callback) =>
              register(host.tool.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          vcs: {
            get: adaptApiMethod(VcsEndpoints["vcs.get"], host.vcs.get),
            base: adaptApiMethod(VcsEndpoints["vcs.base"], host.vcs.base),
            branches: adaptApiMethod(VcsEndpoints["vcs.branches"], host.vcs.branches),
            status: adaptApiMethod(VcsEndpoints["vcs.status"], host.vcs.status),
            diff: adaptApiMethod(VcsEndpoints["vcs.diff"], host.vcs.diff),
            reload: () => run(host.vcs.reload()),
            transform: (callback) =>
              register(
                host.vcs.transform((draft) => {
                  callback({
                    add: (definition) => {
                      const base = definition.base?.bind(definition)
                      draft.add({
                        id: definition.id,
                        name: definition.name,
                        info: (input) => attempt((signal) => definition.info(input, { signal })),
                        base: base ? (input) => attempt((signal) => base(input, { signal })) : undefined,
                        branches: (input) => attempt((signal) => definition.branches(input, { signal })),
                        status: (input) => attempt((signal) => definition.status(input, { signal })),
                        diff: (input) => attempt((signal) => definition.diff(input, { signal })),
                      })
                    },
                    default: draft.default,
                  })
                }),
              ),
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
            hook: (name, callback, options) =>
              register(
                host.session.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))), options),
              ),
            create: adaptApiMethod(SessionEndpoints["session.create"], host.session.create),
            get: adaptApiMethod(SessionEndpoints["session.get"], host.session.get),
            switchAgent: adaptApiMethod(SessionEndpoints["session.switchAgent"], host.session.switchAgent),
            switchModel: adaptApiMethod(SessionEndpoints["session.switchModel"], host.session.switchModel),
            prompt: adaptApiMethod(SessionEndpoints["session.prompt"], host.session.prompt),
            generate: adaptApiMethod(SessionEndpoints["session.generate"], host.session.generate),
            command: adaptApiMethod(SessionEndpoints["session.command"], host.session.command),
            synthetic: adaptApiMethod(SessionEndpoints["session.synthetic"], host.session.synthetic),
            interrupt: adaptApiMethod(SessionEndpoints["session.interrupt"], host.session.interrupt),
            rename: adaptApiMethod(SessionEndpoints["session.rename"], host.session.rename),
            move: adaptApiMethod(SessionEndpoints["session.move"], host.session.move),
            wait: adaptApiMethod(SessionEndpoints["session.wait"], host.session.wait),
            context: adaptApiMethod(SessionEndpoints["session.context"], host.session.context),
          },
          shell: {
            hook: (name, callback) =>
              register(host.shell.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
        }

        yield* Effect.acquireRelease(
          Effect.promise(() => Promise.resolve(plugin.setup(context2))),
          (cleanup) => (cleanup ? Effect.promise(() => Promise.resolve(cleanup())) : Effect.void),
        )
      }),
  })
}

function attempt<A>(evaluate: (signal: AbortSignal) => PromiseLike<A>) {
  return Effect.tryPromise({ try: evaluate, catch: (cause) => cause })
}

type RuntimeSchema = Schema.Codec<unknown, unknown>

const executePromiseTool = (tool: Info, input: any, context: Tool.Context) =>
  Effect.promise(() =>
    tool.execute(input, {
      ...context,
      progress: (update) => Effect.runPromise(context.progress(update)),
    }),
  )
