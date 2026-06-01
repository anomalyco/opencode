import type { AgentSideConnection, Usage } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import type { AssistantMessage as OpenCodeAssistantMessage, Message } from "@opencode-ai/sdk/v2"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "@/provider/provider"
import { Context, Effect, Layer, SynchronizedRef } from "effect"

const log = Log.create({ service: "acp-usage" })

export type AssistantTokenCost = Pick<OpenCodeAssistantMessage, "cost" | "tokens">

export type AssistantMessage = AssistantTokenCost &
  Pick<OpenCodeAssistantMessage, "role"> &
  Partial<Pick<OpenCodeAssistantMessage, "providerID" | "modelID">>

export type SessionMessage = {
  readonly info: { readonly role: Message["role"] } | AssistantMessage
}

export type MessagesInput = {
  readonly sessionID: string
  readonly directory: string
}

export type SDK = {
  readonly session: {
    readonly messages: (
      parameters: { readonly sessionID: string; readonly directory: string },
      options: { readonly throwOnError: true },
    ) => Promise<{ readonly data?: readonly SessionMessage[] | null }>
  }
}

export interface MessageLoaderInterface {
  readonly messages: (input: MessagesInput) => Effect.Effect<readonly SessionMessage[], unknown>
}

export interface ContextLimitLoaderInterface {
  readonly providers: (directory: string) => Effect.Effect<Record<ProviderV2.ID, Provider.Info>, unknown>
}

export type UsageConnection = Pick<AgentSideConnection, "sessionUpdate">

export interface Interface {
  readonly buildUsage: (message: AssistantTokenCost) => Usage
  readonly latestAssistantMessage: (messages: readonly SessionMessage[]) => AssistantMessage | undefined
  readonly totalSessionCost: (messages: readonly SessionMessage[]) => number
  readonly contextLimit: (input: {
    readonly directory: string
    readonly providerID: ProviderV2.ID
    readonly modelID: ProviderV2.ModelID
  }) => Effect.Effect<number | undefined>
  readonly sendUpdate: (input: {
    readonly connection: UsageConnection
    readonly sessionID: string
    readonly directory: string
  }) => Effect.Effect<void>
}

export class MessageLoader extends Context.Service<MessageLoader, MessageLoaderInterface>()(
  "@opencode/ACPUsageMessageLoader",
) {}

export class ContextLimitLoader extends Context.Service<ContextLimitLoader, ContextLimitLoaderInterface>()(
  "@opencode/ACPUsageContextLimitLoader",
) {}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPUsage") {}

export function messageLoaderFromSDK(sdk: SDK): MessageLoaderInterface {
  return MessageLoader.of({
    messages: (input) =>
      Effect.promise(() =>
        sdk.session
          .messages({ sessionID: input.sessionID, directory: input.directory }, { throwOnError: true })
          .then((response) => response.data ?? []),
      ),
  })
}

export const messageLoaderLayer = (sdk: SDK) => Layer.succeed(MessageLoader, messageLoaderFromSDK(sdk))

export function buildUsage(message: AssistantTokenCost): Usage {
  const cachedReadTokens = message.tokens.cache.read
  const cachedWriteTokens = message.tokens.cache.write
  const thoughtTokens = message.tokens.reasoning

  return {
    inputTokens: message.tokens.input,
    outputTokens: message.tokens.output,
    totalTokens: message.tokens.input + message.tokens.output + thoughtTokens + cachedReadTokens + cachedWriteTokens,
    ...(thoughtTokens > 0 ? { thoughtTokens } : {}),
    ...(cachedReadTokens > 0 ? { cachedReadTokens } : {}),
    ...(cachedWriteTokens > 0 ? { cachedWriteTokens } : {}),
  }
}

export function latestAssistantMessage(messages: readonly SessionMessage[]): AssistantMessage | undefined {
  return messages
    .filter((message): message is { readonly info: AssistantMessage } => message.info.role === "assistant")
    .at(-1)?.info
}

export function totalSessionCost(messages: readonly SessionMessage[]): number {
  return messages
    .filter((message): message is { readonly info: AssistantMessage } => message.info.role === "assistant")
    .reduce((sum, message) => sum + message.info.cost, 0)
}

export function findContextLimit(
  providers: Record<ProviderV2.ID, Provider.Info>,
  providerID: ProviderV2.ID,
  modelID: ProviderV2.ModelID,
): number | undefined {
  return providers[providerID]?.models[modelID]?.limit.context
}

export const contextLimitLoaderLayer = Layer.effect(
  ContextLimitLoader,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const provider = yield* Provider.Service

    return ContextLimitLoader.of({
      providers: Effect.fn("ACPUsageContextLimitLoader.providers")(function* (directory) {
        const ctx = yield* store.load({ directory })
        return yield* Effect.gen(function* () {
          return yield* provider.list()
        }).pipe(Effect.provideService(InstanceRef, ctx))
      }),
    })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const messageLoader = yield* MessageLoader
    const contextLimitLoader = yield* ContextLimitLoader
    const limits = yield* SynchronizedRef.make(new Map<string, Effect.Effect<number | undefined>>())

    const cachedLimit = Effect.fnUntraced(function* (input: {
      readonly directory: string
      readonly providerID: ProviderV2.ID
      readonly modelID: ProviderV2.ModelID
    }) {
      return yield* SynchronizedRef.modifyEffect(
        limits,
        Effect.fnUntraced(function* (items) {
          const key = `${input.directory}\u0000${input.providerID}\u0000${input.modelID}`
          const current = items.get(key)
          if (current) return [current, items] as const
          const next = yield* Effect.cached(
            contextLimitLoader.providers(input.directory).pipe(
              Effect.map((providers) => findContextLimit(providers, input.providerID, input.modelID)),
              Effect.catch((error) =>
                Effect.sync(() => {
                  log.error("failed to get providers for usage context limit", { error })
                  return undefined
                }),
              ),
            ),
          )
          return [next, new Map(items).set(key, next)] as const
        }),
      )
    })

    const contextLimit = Effect.fn("ACPUsage.contextLimit")(function* (input: {
      readonly directory: string
      readonly providerID: ProviderV2.ID
      readonly modelID: ProviderV2.ModelID
    }) {
      return yield* yield* cachedLimit(input)
    })

    const sendUpdate = Effect.fn("ACPUsage.sendUpdate")(function* (input: {
      readonly connection: UsageConnection
      readonly sessionID: string
      readonly directory: string
    }) {
      const messages = yield* messageLoader.messages({ sessionID: input.sessionID, directory: input.directory }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log.error("failed to fetch messages for usage update", { error })
            return undefined
          }),
        ),
      )
      if (!messages) return

      const message = latestAssistantMessage(messages)
      if (!message) return
      if (!message.providerID || !message.modelID) return

      const size = yield* contextLimit({
        directory: input.directory,
        providerID: ProviderV2.ID.make(message.providerID),
        modelID: ProviderV2.ModelID.make(message.modelID),
      })
      if (!size) return

      yield* Effect.promise(() =>
        input.connection
          .sessionUpdate({
            sessionId: input.sessionID,
            update: {
              sessionUpdate: "usage_update",
              used: message.tokens.input + message.tokens.cache.read,
              size,
              cost: { amount: totalSessionCost(messages), currency: "USD" },
            },
          })
          .catch((error) => {
            log.error("failed to send usage update", { error })
          }),
      )
    })

    return Service.of({
      buildUsage,
      latestAssistantMessage,
      totalSessionCost,
      contextLimit,
      sendUpdate,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(contextLimitLoaderLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(InstanceStore.defaultLayer),
)

export * as UsageService from "./usage"
