import type {
  AgentApi as EffectAgentApi,
  CommandApi as EffectCommandApi,
  EventApi as EffectEventApi,
  IntegrationApi as EffectIntegrationApi,
  ModelApi as EffectModelApi,
  PluginApi as EffectPluginApi,
  ProviderApi as EffectProviderApi,
  ReferenceApi as EffectReferenceApi,
  SessionApi as EffectSessionApi,
  SkillApi as EffectSkillApi,
} from "../effect/api/api.js"
import type { Effect, Stream } from "effect"

type PromisifyOperation<Operation> = Operation extends (
  ...args: infer Args
) => Effect.Effect<infer Success, unknown, unknown>
  ? (...args: Args) => Promise<Success>
  : Operation extends (...args: infer Args) => Stream.Stream<infer Success, unknown, unknown>
    ? (...args: Args) => AsyncIterable<Success>
    : Operation extends (...args: infer _Args) => unknown
      ? Operation
      : Operation extends object
        ? PromisifyApi<Operation>
        : Operation

type PromisifyApi<Api> = {
  readonly [Name in keyof Api]: PromisifyOperation<Api[Name]>
}

export type AgentApi = PromisifyApi<EffectAgentApi<unknown>>
export type CommandApi = PromisifyApi<EffectCommandApi<unknown>>
export type EventApi = PromisifyApi<EffectEventApi<unknown>>
export type IntegrationApi = PromisifyApi<EffectIntegrationApi<unknown>>
export type ModelApi = PromisifyApi<EffectModelApi<unknown>>
export type PluginApi = PromisifyApi<EffectPluginApi<unknown>>
export type ProviderApi = PromisifyApi<EffectProviderApi<unknown>>
export type ReferenceApi = PromisifyApi<EffectReferenceApi<unknown>>
export type SessionApi = PromisifyApi<EffectSessionApi<unknown>>
export type SkillApi = PromisifyApi<EffectSkillApi<unknown>>

export interface CatalogApi {
  readonly provider: ProviderApi
  readonly model: ModelApi
}
