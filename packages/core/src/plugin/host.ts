export * as PluginHost from "./host"

import { Plugin } from "@opencode-ai/plugin/effect"
import type { IntegrationMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import type { CredentialOAuth } from "@opencode-ai/sdk/v2/types"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { App } from "../app"
import { Effect, Schema, Stream } from "effect"
import { Agent } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { Command } from "../command"
import { Credential } from "../credential"
import { Bus } from "../bus"
import { Integration } from "../integration"
import { Location } from "../location"
import { Model } from "../model"
import { PluginRuntime } from "./runtime"
import { Provider } from "../provider"
import { Reference } from "../reference"
import { AbsolutePath, type DeepMutable } from "../schema"
import { Skill } from "../skill"
import { Tool } from "../tool"
import { Workspace } from "../workspace"
import { WebSearch } from "../websearch"
import { PluginHooks } from "./hooks"

const mutable = <T>(value: T) => value as DeepMutable<T>
export const make = Effect.fn("PluginHost.make")(function* (plugin: import("../plugin").Interface) {
  const app = yield* App.Metadata
  const agents = yield* Agent.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* Command.Service
  const bus = yield* Bus.Service
  const integration = yield* Integration.Service
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
      hook: (name, callback) => {
        if (name === "sdk") {
          return aisdk.hook.sdk((event) => {
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
            label: input.label,
          }),
      },
      oauth: {
        connect: (input) =>
          response(
            integration.oauth.connect({
              integrationID: Integration.ID.make(input.integrationID),
              methodID: Integration.MethodID.make(input.methodID),
              inputs: input.inputs,
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
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => draft.method.update(methodImplementation(input)),
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
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
            source: (source) => draft.source(Schema.decodeUnknownSync(Skill.Source)(source)),
            list: draft.list,
          })
        }),
    },
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
              set: (providerID) => draft.default.set(WebSearch.ID.make(providerID)),
            },
          })
        }),
    },
    session: {
      hook: (name, callback) => hooks.register("session", name, callback),
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

function methodImplementation(input: IntegrationMethodRegistration): Integration.Implementation {
  if ("authorize" in input) {
    const refresh = input.refresh
    return {
      integrationID: Integration.ID.make(input.integrationID),
      method: { ...input.method, id: Integration.MethodID.make(input.method.id) },
      authorize: (inputs) =>
        input.authorize(inputs).pipe(
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
      method: { type: "env", names: input.method.names },
    }
  }
  if (input.method.type === "command") {
    return {
      integrationID: Integration.ID.make(input.integrationID),
      method: Schema.decodeUnknownSync(Integration.CommandMethod)(input.method),
    }
  }
  return {
    integrationID: Integration.ID.make(input.integrationID),
    method: { type: "key", label: input.method.label },
  }
}

function credential(value: CredentialOAuth) {
  return Credential.OAuth.make({ ...value, methodID: Integration.MethodID.make(value.methodID) })
}
