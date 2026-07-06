export * as PluginHost from "./host"

import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Effect, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { PluginRuntime } from "./runtime"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import { AbsolutePath, type DeepMutable } from "../schema"
import { SkillV2 } from "../skill"
import { Tools } from "../tool/tools"
import { ToolHooks } from "../tool/hooks"
import { WorkspaceV2 } from "../workspace"

const mutable = <T>(value: T) => value as DeepMutable<T>
export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  const location = yield* Location.Service
  const reference = yield* Reference.Service
  const skill = yield* SkillV2.Service
  const tools = yield* Tools.Service
  const toolHooks = yield* ToolHooks.Service
  const runtime = yield* PluginRuntime.Service
  const locationInfo = () =>
    new Location.Info({
      directory: location.directory,
      workspaceID: location.workspaceID,
      project: location.project,
    })
  const locationRef = (input?: Parameters<PluginContext["agent"]["list"]>[0]) =>
    input?.location === undefined
      ? undefined
      : Location.Ref.make({
          directory: AbsolutePath.make(input.location.directory ?? location.directory),
          workspaceID:
            input.location.workspace === undefined
              ? location.workspaceID
              : WorkspaceV2.ID.make(input.location.workspace),
        })
  const isCurrentLocation = (ref: Location.Ref) =>
    ref.directory === location.directory && ref.workspaceID === location.workspaceID
  const response = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.map((data) => ({ location: locationInfo(), data })))

  return {
    options: {},
    agent: {
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
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          })
        }),
    },
    aisdk: {
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      provider: {
        list: () => response(catalog.provider.available()),
        get: (input) =>
          catalog.provider
            .get(ProviderV2.ID.make(input.providerID))
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
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
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
      subscribe: () => events.live().pipe(Stream.filter(EventManifest.isServer)),
    },
    integration: {
      list: () => response(integration.list()),
      get: (input) => response(integration.get(Integration.ID.make(input.integrationID))),
      connectKey: (input) =>
        integration.connection.key({
          integrationID: Integration.ID.make(input.integrationID),
          key: input.key,
          label: input.label,
        }),
      connectOauth: (input) =>
        response(
          integration.connection.oauth({
            integrationID: Integration.ID.make(input.integrationID),
            methodID: Integration.MethodID.make(input.methodID),
            inputs: input.inputs,
            label: input.label,
          }),
        ),
      attemptStatus: (input) => response(integration.attempt.status(Integration.AttemptID.make(input.attemptID))),
      attemptComplete: (input) =>
        integration.attempt.complete({ attemptID: Integration.AttemptID.make(input.attemptID), code: input.code }),
      attemptCancel: (input) => integration.attempt.cancel(Integration.AttemptID.make(input.attemptID)),
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
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
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
            source: (source) => draft.source(Schema.decodeUnknownSync(SkillV2.Source)(source)),
            list: draft.list,
          })
        }),
    },
    tool: {
      register: (input, options) => tools.register(input, options),
      execute: {
        before: (callback) =>
          toolHooks.hook.before((event) => {
            const output = {
              tool: event.tool,
              sessionID: event.sessionID,
              agent: event.agent,
              assistantMessageID: event.assistantMessageID,
              toolCallID: event.toolCallID,
              input: event.input,
            }
            const result = callback(output)
            return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
              Effect.tap(() => Effect.sync(() => (event.input = output.input))),
            )
          }),
        after: (callback) =>
          toolHooks.hook.after((event) => {
            const output = {
              tool: event.tool,
              sessionID: event.sessionID,
              agent: event.agent,
              assistantMessageID: event.assistantMessageID,
              toolCallID: event.toolCallID,
              input: event.input,
              result: event.result,
              output: event.output,
              outputPaths: event.outputPaths,
            }
            const result = callback(output)
            return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  event.result = output.result
                  event.output = output.output
                  event.outputPaths = output.outputPaths
                }),
              ),
            )
          }),
      },
    },
    session: {
      create: (input) =>
        runtime.session.create({
          id: input?.id,
          agent: input?.agent,
          model: input?.model,
          location:
            input?.location ?? Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
        }),
      get: (input) => runtime.session.get(input.sessionID),
      prompt: runtime.session.prompt,
      command: runtime.session.command,
      interrupt: (input) => runtime.session.interrupt(input.sessionID),
    },
  } satisfies PluginContext
})
