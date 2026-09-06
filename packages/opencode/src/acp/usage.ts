import type { AgentSideConnection, Usage } from "@agentclientprotocol/sdk"
import type { AssistantMessage as OpenCodeAssistantMessage, Message } from "@opencode-ai/sdk/v2"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { makeGlobalNode, Node } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { Context, Effect, Layer, SynchronizedRef } from "effect"

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
    readonly modelID: ModelV2.ID
  }) => Effect.Effect<number | undefined>
  readonly sendUpdate: (input: {
    readonly connection: UsageConnection
    readonly sessionID: string
    readonly directory: string
  }) => Effect.Effect<readonly SessionMessage[] | undefined>
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

export function contextTokens(message: AssistantTokenCost): number {
  return message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
}

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

/**
 * Usage summed over the current turn: every assistant message after the last
 * user message. Each tool-call step is its own assistant message, so the final
 * message alone under-counts a multi-step turn. Subtask and compaction
 * messages are parented to the same user message and count toward the turn.
 */
export function turnUsage(messages: readonly SessionMessage[]): Usage | undefined {
  const start = messages.findLastIndex((message) => message.info.role === "user") + 1
  const turn = messages
    .slice(start)
    .map((message) => message.info)
    .filter((info): info is AssistantMessage => info.role === "assistant")
  if (turn.length === 0) return undefined
  return buildUsage(
    turn.reduce(
      (total, info) => ({
        cost: total.cost + info.cost,
        tokens: {
          input: total.tokens.input + info.tokens.input,
          output: total.tokens.output + info.tokens.output,
          reasoning: total.tokens.reasoning + info.tokens.reasoning,
          cache: {
            read: total.tokens.cache.read + info.tokens.cache.read,
            write: total.tokens.cache.write + info.tokens.cache.write,
          },
        },
      }),
      { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    ),
  )
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
  modelID: ModelV2.ID,
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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const messageLoader = yield* MessageLoader
    const contextLimitLoader = yield* ContextLimitLoader
    const limits = yield* SynchronizedRef.make(new Map<string, Effect.Effect<number | undefined>>())

    const cachedLimit = Effect.fnUntraced(function* (input: {
      readonly directory: string
      readonly providerID: ProviderV2.ID
      readonly modelID: ModelV2.ID
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
                Effect.logError("failed to get providers for usage context limit", { error: error }).pipe(
                  Effect.as(undefined),
                ),
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
      readonly modelID: ModelV2.ID
    }) {
      return yield* yield* cachedLimit(input)
    })

    const sendUpdate = Effect.fn("ACPUsage.sendUpdate")(function* (input: {
      readonly connection: UsageConnection
      readonly sessionID: string
      readonly directory: string
    }) {
      const messages = yield* messageLoader
        .messages({ sessionID: input.sessionID, directory: input.directory })
        .pipe(
          Effect.catch((error) =>
            Effect.logError("failed to fetch messages for usage update", { error: error }).pipe(Effect.as(undefined)),
          ),
        )
      if (!messages) return undefined

      const message = latestAssistantMessage(messages)
      if (!message) return messages
      if (!message.providerID || !message.modelID) return messages

      const size = yield* contextLimit({
        directory: input.directory,
        providerID: ProviderV2.ID.make(message.providerID),
        modelID: ModelV2.ID.make(message.modelID),
      })
      if (!size) return messages

      yield* Effect.promise(() =>
        input.connection
          .sessionUpdate({
            sessionId: input.sessionID,
            update: {
              sessionUpdate: "usage_update",
              used: contextTokens(message),
              size,
              cost: { amount: totalSessionCost(messages), currency: "USD" },
            },
          })
          .catch(() => {}),
      )
      return messages
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

export const messageLoaderNode = LayerNode.unbound(MessageLoader, Node.tags.values.global)

export const contextLimitLoaderNode = makeGlobalNode({
  service: ContextLimitLoader,
  layer: contextLimitLoaderLayer,
  deps: [Provider.node, InstanceStore.node],
})

export const node = makeGlobalNode({ service: Service, layer, deps: [messageLoaderNode, contextLimitLoaderNode] })

export * as UsageService from "./usage"
