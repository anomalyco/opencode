import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { LLM } from "@/session/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Effect, Layer, Context, Schema, Stream, type Layer as EffectLayer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { LLMEvent } from "@opencode-ai/llm"
import type { ModelMessage } from "ai"

export const Event = {
  Response: EventV2.define({
    type: "side-question.response",
    schema: {
      sessionID: SessionID,
      messageID: MessageID,
      text: Schema.String,
    },
  }),
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<SessionV1.WithParts, unknown>
}

export interface AskInput {
  sessionID: SessionID
  question: string
  model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  agent?: string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SideQuestion") {}

export const layer: Layer.Layer<
  Service,
  never,
  Session.Service | Agent.Service | Provider.Service | LLM.Service | EventV2Bridge.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service

    const ask = Effect.fn("SideQuestion.ask")(function* (input: AskInput) {
      const sessionInfo = yield* session.get(input.sessionID)
      const agentInfo = input.agent ? yield* agents.get(input.agent) : yield* agents.defaultInfo()
      const agentName = agentInfo.name

      const providerSvc = yield* Provider.Service
      const providers = yield* providerSvc.list()
      const allModels = Object.values(providers).flatMap((p) => Object.entries(p.models))
      if (allModels.length === 0) {
        throw new Error("No models available")
      }
      const model = input.model ?? {
        providerID: allModels[0][0] as ProviderV2.ID,
        modelID: allModels[0][1].id as ModelV2.ID,
      }

      const messages = yield* MessageV2.page({ sessionID: input.sessionID, limit: 100 })
      const msgList = messages.items

      const conversationHistory = msgList
        .filter((m) => m.info.role === "user" || m.info.role === "assistant")
        .slice(-20)
        .map((m) => ({
          role: m.info.role as "user" | "assistant",
          content: m.parts
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("\n"),
        }))
        .filter((m) => m.content.trim().length > 0)

      const messagesForLLM: ModelMessage[] = [
        {
          role: "system",
          content:
            "You are a helpful assistant answering side questions from the user. Answer concisely based on the conversation context.",
        },
        ...conversationHistory,
        { role: "user", content: input.question },
      ]

      const modelInfo = yield* providerSvc.getModel(model.providerID, model.modelID)
      const providerModel = {
        id: model.modelID,
        providerID: model.providerID,
        api: modelInfo?.api ?? { id: "", url: "", npm: "" },
        name: modelInfo?.name ?? "",
        family: modelInfo?.family ?? "",
        limit: modelInfo?.limit ?? { context: 4096, input: 0, output: 0 },
        cost: modelInfo?.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
        capabilities: modelInfo?.capabilities ?? {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        headers: {},
        options: {},
        status: "active" as const,
        sizeBytes: modelInfo?.sizeBytes,
        version: "",
        release_date: "",
        context_length: modelInfo?.limit.context ?? 4096,
        max_output_tokens: modelInfo?.limit.output ?? 0,
        max_context_length: modelInfo?.limit.context ?? 4096,
        max_tokens: modelInfo?.limit.context ?? 4096,
        reasoning: modelInfo?.capabilities.reasoning ?? false,
      }

      const userMessage: SessionV1.User = {
        id: MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        agent: agentName,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
      }

      const ctx = yield* InstanceState.context

      const stream = llm.stream({
        sessionID: input.sessionID,
        model: providerModel,
        messages: messagesForLLM,
        agent: agentInfo,
        user: userMessage,
        system: [],
        tools: {},
      })

      const collected = yield* stream.pipe(Stream.runCollect)

      const fullText = collected
        .filter((e: LLMEvent) => e.type === "text-delta")
        .map((e: LLMEvent) => (e as any).text)
        .join("")

      const messageID = MessageID.ascending()
      const partID = PartID.ascending()

      const assistantMessage: SessionV1.WithParts = {
        info: {
          id: messageID,
          sessionID: input.sessionID,
          role: "assistant",
          parentID: userMessage.id,
          agent: agentName,
          mode: "side-question",
          variant: undefined,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.modelID,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        },
        parts: [
          {
            id: partID,
            type: "text",
            text: fullText,
            messageID: messageID,
            sessionID: input.sessionID,
          },
        ],
      }

      yield* events.publish(Event.Response, {
        sessionID: input.sessionID,
        messageID,
        text: fullText,
      })

      return assistantMessage
    })

    return Service.of({ ask } as Interface)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(LLM.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export const node = LayerNode.make(layer, [Session.node, Agent.node, Provider.node, LLM.node, EventV2Bridge.node])

export * as SideQuestion from "."
