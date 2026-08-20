export * as PluginHost from "./host.js"

import { Plugin } from "@opencode-ai/plugin/effect"
import type { IntegrationMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import type { CredentialOAuth } from "@opencode-ai/sdk/v2/types"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Mcp } from "@opencode-ai/schema/mcp"
import { App } from "../app.js"
import { DateTime, Effect, Schema, Stream } from "effect"
import { Agent } from "../agent.js"
import { AISDK } from "../aisdk.js"
import { Catalog } from "../catalog.js"
import { Command } from "../command.js"
import { Credential } from "../credential.js"
import { Bus } from "../bus.js"
import { Integration } from "../integration.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { Model } from "../model.js"
import { MCP } from "../mcp/index.js"
import { PluginRuntime } from "./runtime.js"
import { Provider } from "../provider.js"
import { Reference } from "../reference.js"
import { AbsolutePath, type DeepMutable } from "../schema.js"
import { Skill } from "../skill.js"
import { Tool } from "../tool.js"
import { Workspace } from "../workspace.js"
import { WebSearch } from "../websearch.js"
import { PluginHooks } from "./hooks.js"
import { Session } from "../session.js"
import { SessionMessage } from "../session/message.js"

const mutable = <T>(value: T) => value as DeepMutable<T>
type SessionListInput = Exclude<Parameters<Plugin.Context["session"]["list"]>[0], undefined>
type SessionListCursor = Exclude<SessionListInput["cursor"], undefined>

const MessageCursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Literals(["asc", "desc"]),
  direction: Schema.Literals(["previous", "next"]),
})

export const make = Effect.fn("PluginHost.make")(function* (
  plugin: import("../plugin.js").Interface,
  pluginID: string = "test",
) {
  const app = yield* App.Metadata
  const agents = yield* Agent.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* Command.Service
  const bus = yield* Bus.Service
  const integration = yield* Integration.Service
  const kv = yield* KV.Service
  const mcp = yield* MCP.Service
  const location = yield* Location.Service
  const reference = yield* Reference.Service
  const skill = yield* Skill.Service
  const tools = yield* Tool.Service
  const websearch = yield* WebSearch.Service
  const hooks = yield* PluginHooks.Service
  const runtime = yield* PluginRuntime.Service
  const locationInfo = () =>
    new Location.Info({
      directory: location.directory,
      workspaceID: location.workspaceID,
      project: location.project,
    })
  const locationRef = (input?: { readonly location?: { readonly directory?: string; readonly workspace?: string } }) =>
    input?.location === undefined
      ? undefined
      : Location.Ref.make({
          directory: AbsolutePath.make(input.location.directory ?? location.directory),
          workspaceID:
            input.location.workspace === undefined ? location.workspaceID : Workspace.ID.make(input.location.workspace),
        })
  const isCurrentLocation = (ref: Location.Ref) =>
    ref.directory === location.directory && ref.workspaceID === location.workspaceID
  const response = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.map((data) => ({ location: locationInfo(), data })))
  const sessionList = (input?: SessionListInput, parentID?: Session.ID) =>
    Effect.gen(function* () {
      const decoded = input?.cursor === undefined ? sessionListQuery(input) : yield* decodeSessionCursor(input.cursor)
      const query = parentID === undefined ? decoded : { ...decoded, parentID }
      const page = yield* runtime.session.list({ ...query, limit: input?.limit ?? 50 })
      const first = page.data[0]
      const last = page.data.at(-1)
      return {
        data: page.data,
        cursor: {
          previous:
            first === undefined
              ? undefined
              : encodeSessionCursor(query, {
                  id: first.id,
                  time: DateTime.toEpochMillis(first.time.updated),
                  direction: "previous",
                }),
          next:
            last === undefined
              ? undefined
              : encodeSessionCursor(query, {
                  id: last.id,
                  time: DateTime.toEpochMillis(last.time.updated),
                  direction: "next",
                }),
        },
      }
    })
  const sessionMessages = (input: Parameters<Plugin.Context["session"]["messages"]>[0]) =>
    Effect.gen(function* () {
      if (input.cursor !== undefined && input.order !== undefined)
        return yield* Effect.fail(new Error("Invalid cursor"))
      const decoded = input.cursor === undefined ? undefined : yield* decodeMessageCursor(input.cursor)
      const order = decoded?.order ?? input.order ?? "desc"
      const messages = yield* runtime.session.messages({
        sessionID: input.sessionID,
        limit: input.limit ?? 50,
        order,
        cursor: decoded === undefined ? undefined : { id: decoded.id, direction: decoded.direction },
      })
      const first = messages[0]
      const last = messages.at(-1)
      return {
        data: messages,
        cursor: {
          previous: first === undefined ? undefined : encodeMessageCursor(first, order, "previous"),
          next: last === undefined ? undefined : encodeMessageCursor(last, order, "next"),
        },
      }
    })

  return {
    app,
    options: {},
    agent: {
      get: (input) => {
        const ref = locationRef(input)
        const output =
          ref && !isCurrentLocation(ref)
            ? runtime.location.agent.list(ref).pipe(
                Effect.map((result) => ({
                  ...result,
                  data: result.data.find((agent) => agent.id === input.agentID),
                })),
              )
            : response(agents.get(input.agentID))
        return output.pipe(
          Effect.flatMap((result) =>
            result.data
              ? Effect.succeed({ ...result, data: result.data })
              : Effect.fail(new Error(`Agent not found: ${input.agentID}`)),
          ),
        )
      },
      list: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.agent.list(ref)
        return agents.list().pipe(Effect.map((data) => ({ location: locationInfo(), data })))
      },
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) => {
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Agent.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : Agent.ID.make(id)),
            update: (id, update) => draft.update(Agent.ID.make(id), update),
            remove: (id) => draft.remove(Agent.ID.make(id)),
          })
        }),
    },
    aisdk: {
      hook: (name, callback, options) => {
        if (name === "sdk") {
          return aisdk.hook.sdk((event) => {
            if (options?.providerID !== undefined && options.providerID !== event.model.providerID) return Effect.void
            const output = {
              model: mutable(event.model),
              package: event.package,
              options: event.options,
              sdk: event.sdk,
            }
            return Reflect.apply(callback, undefined, [output]).pipe(
              Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
            )
          })
        }
        return aisdk.hook.language((event) => {
          if (options?.providerID !== undefined && options.providerID !== event.model.providerID) return Effect.void
          const output = {
            model: mutable(event.model),
            options: event.options,
            sdk: event.sdk,
            language: event.language,
          }
          return Reflect.apply(callback, undefined, [output]).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        })
      },
    },
    catalog: {
      provider: {
        list: () => response(catalog.provider.available()),
        get: (input) =>
          catalog.provider
            .get(Provider.ID.make(input.providerID))
            .pipe(
              Effect.flatMap((provider) =>
                provider === undefined
                  ? Effect.fail(new Error(`Provider not found: ${input.providerID}`))
                  : response(Effect.succeed(provider)),
              ),
            ),
      },
      model: {
        list: () => response(catalog.model.available()),
        default: () => response(catalog.model.default()),
      },
      reload: catalog.reload,
      transform: (callback) =>
        catalog.transform((draft) => {
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(Provider.ID.make(id))),
              update: (id, update) => draft.provider.update(Provider.ID.make(id), update),
              remove: (id) => draft.provider.remove(Provider.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(Provider.ID.make(providerID), Model.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(Provider.ID.make(providerID), Model.ID.make(modelID), update),
              remove: (providerID, modelID) => draft.model.remove(Provider.ID.make(providerID), Model.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(Provider.ID.make(providerID), Model.ID.make(modelID)),
              },
            },
          })
        }),
    },
    command: {
      list: () => response(commands.list()),
      reload: commands.reload,
      transform: (callback) =>
        commands.transform((draft) => {
          callback(draft)
        }),
    },
    event: {
      subscribe: () => bus.subscribe().pipe(Stream.filter(EventManifest.isServer)),
    },
    integration: {
      list: () => response(integration.list()),
      get: (input) => response(integration.get(Integration.ID.make(input.integrationID))),
      connect: {
        key: (input) =>
          integration.connection.key({
            integrationID: Integration.ID.make(input.integrationID),
            key: input.key,
            answer: input.answer,
            label: input.label,
          }),
      },
      oauth: {
        connect: (input) =>
          response(
            integration.oauth.connect({
              integrationID: Integration.ID.make(input.integrationID),
              methodID: Integration.MethodID.make(input.methodID),
              answer: input.answer,
              label: input.label,
            }),
          ),
        status: (input) =>
          response(
            integration.oauth.status({
              integrationID: Integration.ID.make(input.integrationID),
              attemptID: Integration.AttemptID.make(input.attemptID),
            }),
          ),
        complete: (input) =>
          integration.oauth.complete({
            integrationID: Integration.ID.make(input.integrationID),
            attemptID: Integration.AttemptID.make(input.attemptID),
            code: input.code,
          }),
        cancel: (input) =>
          integration.oauth.cancel({
            integrationID: Integration.ID.make(input.integrationID),
            attemptID: Integration.AttemptID.make(input.attemptID),
          }),
      },
      command: {
        connect: (input) =>
          response(
            integration.command.connect({
              integrationID: Integration.ID.make(input.integrationID),
              methodID: Integration.MethodID.make(input.methodID),
              label: input.label,
            }),
          ),
        status: (input) =>
          response(
            integration.command.status({
              integrationID: Integration.ID.make(input.integrationID),
              attemptID: Integration.AttemptID.make(input.attemptID),
            }),
          ),
        cancel: (input) =>
          integration.command.cancel({
            integrationID: Integration.ID.make(input.integrationID),
            attemptID: Integration.AttemptID.make(input.attemptID),
          }),
      },
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) => {
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => draft.method.list(Integration.ID.make(id)),
              update: (input) => draft.method.update(methodImplementation(input)),
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
          })
        }),
    },
    mcp: {
      list: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.mcp.list(ref)
        return response(mcp.servers())
      },
      add: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.mcp.add(ref, input.server, input.config)
        return mcp.add(input.server, input.config)
      },
      remove: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.mcp.remove(ref, input.server)
        return mcp.remove(input.server)
      },
      connect: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.mcp.connect(ref, input.server)
        return mcp.connect(input.server)
      },
      disconnect: (input) => {
        const ref = locationRef(input)
        if (ref && !isCurrentLocation(ref)) return runtime.location.mcp.disconnect(ref, input.server)
        return mcp.disconnect(input.server)
      },
      reload: mcp.reload,
      transform: (callback) =>
        mcp.transform((draft) => {
          callback({
            list: () => draft.list().map(([name, config]) => [name, mutable(config)]),
            get: (name) => mutable(draft.get(name)),
            set: (name, config) => draft.set(name, Schema.decodeUnknownSync(Mcp.ServerConfig)(config)),
            update: draft.update,
            remove: draft.remove,
          })
        }),
    },
    plugin: {
      list: () => response(plugin.list()),
    },
    reference: {
      list: () => response(reference.list()),
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) => {
          callback({
            add: (name, source) => draft.add(name, Schema.decodeUnknownSync(Reference.Source)(source)),
            remove: draft.remove,
            list: draft.list,
          })
        }),
    },
    skill: {
      list: () => response(skill.list()),
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) => {
          callback({
            list: () => mutable(draft.list()),
            add: (value) => draft.add(Schema.decodeUnknownSync(Skill.Info)(value)),
            update: draft.update,
            remove: draft.remove,
          })
        }),
    },
    storage: storage(kv, pluginID),
    shell: {
      hook: (name, callback) => hooks.register("shell", name, callback),
    },
    tool: {
      transform: (callback) =>
        tools
          .transform((draft) =>
            callback({
              add: (tool) => draft.add(tool),
            }),
          )
          .pipe(Effect.orDie, Effect.as({ dispose: Effect.void })),
      hook: (name, callback) => hooks.register("tool", name, callback),
    },
    websearch: {
      providers: () => response(websearch.providers()),
      query: (input) =>
        response(
          websearch.query({
            query: input.query,
            providerID: input.providerID === undefined ? undefined : WebSearch.ID.make(input.providerID),
          }),
        ),
      reload: websearch.reload,
      transform: (callback) =>
        websearch.transform((draft) => {
          callback({
            add: (definition) =>
              draft.add({
                id: WebSearch.ID.make(definition.id),
                name: definition.name,
                execute: definition.execute,
              }),
            default: {
              get: draft.default.get,
              set: (selection) =>
                draft.default.set(
                  selection === false || selection === "random" ? selection : WebSearch.ID.make(selection),
                ),
            },
          })
        }),
    },
    session: {
      hook: (name, callback, options) => hooks.register("session", name, callback, options),
      list: sessionList,
      children: (input) => sessionList({ cursor: input.cursor, limit: input.limit }, input.sessionID),
      messages: sessionMessages,
      create: (input) =>
        runtime.session.create({
          id: input?.id,
          title: input?.title,
          agent: input?.agent,
          model: input?.model,
          location:
            input?.location ?? Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
        }),
      get: (input) => runtime.session.get(input.sessionID),
      prompt: runtime.session.prompt,
      generate: (input) => runtime.session.generate(input).pipe(Effect.map((text) => ({ text }))),
      command: runtime.session.command,
      rename: runtime.session.rename,
      synthetic: runtime.session.synthetic,
      interrupt: (input) => runtime.session.interrupt(input.sessionID),
      wait: (input) => runtime.session.wait(input.sessionID),
    },
  } satisfies Plugin.Context
})

function sessionListQuery(input?: SessionListInput): Session.ListInput {
  const common = {
    workspaceID: input?.workspace,
    search: input?.search,
    order: input?.order,
    parentID: input?.parentID,
  }
  if (input?.directory !== undefined) return { ...common, directory: input.directory }
  if (input?.project !== undefined) return { ...common, project: input.project, subpath: input.subpath }
  return common
}

function encodeSessionCursor(query: Session.ListInput, anchor: Session.ListAnchor): SessionListCursor {
  const value = {
    workspace: query.workspaceID,
    search: query.search,
    order: query.order,
    parentID: query.parentID,
    anchor,
    ...("directory" in query ? { directory: query.directory } : {}),
    ...("project" in query ? { project: query.project, subpath: query.subpath } : {}),
  }
  return Buffer.from(JSON.stringify(value)).toString("base64url") as SessionListCursor
}

function decodeSessionCursor(input: string) {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(input, "base64url").toString("utf8")),
    catch: () => new Error("Invalid cursor"),
  }).pipe(
    Effect.flatMap((value) => {
      if (typeof value !== "object" || value === null) return Effect.fail(new Error("Invalid cursor"))
      return Schema.decodeUnknownEffect(Session.ListInput)({
        ...value,
        workspaceID: "workspace" in value ? value.workspace : undefined,
      })
    }),
    Effect.mapError(() => new Error("Invalid cursor")),
  )
}

function encodeMessageCursor(message: SessionMessage.Info, order: "asc" | "desc", direction: "previous" | "next") {
  return Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url")
}

function decodeMessageCursor(input: string) {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(input, "base64url").toString("utf8")),
    catch: () => new Error("Invalid cursor"),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MessageCursor)),
    Effect.mapError(() => new Error("Invalid cursor")),
  )
}

export function storage(kv: KV.Interface, pluginID: string): Plugin.Context["storage"] {
  const namespace = `plugin:${pluginID
    .split("")
    .map((value) => value.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")}:`
  return {
    get: (key) => kv.get(namespace + key),
    set: (key, value) => kv.set(namespace + key, value),
    remove: (key) => kv.remove(namespace + key),
    scan: (options) =>
      kv
        .scan({
          prefix: namespace + options.prefix,
          after: options.after === undefined ? undefined : namespace + options.after,
          limit: options.limit,
        })
        .pipe(
          Effect.map((result) => {
            const entries = result.entries.map((entry) => ({
              key: entry.key.slice(namespace.length),
              value: entry.value,
            }))
            if (result.next === undefined) return { entries }
            return { entries, next: result.next.slice(namespace.length) }
          }),
        ),
  }
}

function methodImplementation(input: IntegrationMethodRegistration): Integration.Implementation {
  if ("authorize" in input) {
    const refresh = input.refresh
    return {
      integrationID: Integration.ID.make(input.integrationID),
      method: { ...input.method, id: Integration.MethodID.make(input.method.id) },
      authorize: (answer) =>
        input.authorize(answer).pipe(
          Effect.map((authorization) => {
            if (authorization.mode === "auto") {
              return {
                ...authorization,
                callback: authorization.callback.pipe(Effect.map(credential)),
              }
            }
            return {
              ...authorization,
              callback: (code: string) => authorization.callback(code).pipe(Effect.map(credential)),
            }
          }),
        ),
      ...(refresh ? { refresh: (value: Credential.OAuth) => refresh(value).pipe(Effect.map(credential)) } : {}),
      ...(input.label ? { label: input.label } : {}),
    }
  }
  if (input.method.type === "env") {
    return {
      integrationID: Integration.ID.make(input.integrationID),
      method: input.method,
    }
  }
  if (input.method.type === "command") {
    return {
      integrationID: Integration.ID.make(input.integrationID),
      method: { ...input.method, id: Integration.MethodID.make(input.method.id) },
    }
  }
  return {
    integrationID: Integration.ID.make(input.integrationID),
    method: input.method,
  }
}

function credential(value: CredentialOAuth) {
  return Credential.OAuth.make({ ...value, methodID: Integration.MethodID.make(value.methodID) })
}
