import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema, Cause } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Provider } from "@/provider/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "./message-v2"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { ProviderTransform } from "@/provider/transform"
import { Auth } from "@/auth"

export type Goal = {
  condition: string
  react: number
}

export const Verdict = Schema.Struct({
  ok: Schema.Boolean,
  impossible: Schema.optional(Schema.Boolean),
  reason: Schema.String,
})
export type Verdict = Schema.Schema.Type<typeof Verdict>

const VerdictWithMeta = Schema.Struct({
  ok: Schema.Boolean,
  impossible: Schema.optional(Schema.Boolean),
  reason: Schema.String,
  attempt: Schema.Number,
  messageID: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Boolean),
})

export const Event = {
  Updated: EventV2.define({
    type: "session.goal",
    schema: {
      sessionID: SessionID,
      goal: Schema.optional(Schema.Struct({ condition: Schema.String })),
      lastVerdict: Schema.optional(VerdictWithMeta),
    },
  }),
}

const JUDGE_SYSTEM = `You are evaluating a stop-condition hook in opencode. Read the
conversation transcript carefully, then judge whether the user-provided
condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence>"}
- {"ok": false, "reason": "<quote what is missing>"}
- {"ok": false, "impossible": true, "reason": "<explain why>"}

Always include a "reason" field, quoting specific text from the
transcript whenever possible. If the transcript does not contain clear
evidence that the condition is satisfied, return {"ok": false,
"reason": "insufficient evidence in transcript"}.`

const judgeUser = (condition: string) =>
  `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.\nCondition: ${condition}`

export const MAX_GOAL_REACT = 12

export interface Interface {
  readonly set: (sessionID: SessionID, condition: string) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Goal | undefined>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly bumpReact: (sessionID: SessionID) => Effect.Effect<number>
  readonly evaluate: (input: EvaluateInput) => Effect.Effect<Verdict, Provider.ModelNotFoundError>
}

export type EvaluateInput = {
  condition: string
  msgs: SessionV1.WithParts[]
  model: Provider.Model
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionGoal.state")(() => Effect.succeed(new Map<SessionID, Goal>())),
    )

    const set = Effect.fn("SessionGoal.set")(function* (sessionID: SessionID, condition: string) {
      const data = yield* InstanceState.get(state)
      const goal: Goal = { condition, react: 0 }
      data.set(sessionID, goal)
      yield* events.publish(Event.Updated, { sessionID, goal: { condition } })
    })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID)
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      data.delete(sessionID)
      yield* events.publish(Event.Updated, { sessionID, goal: undefined })
    })

    const bumpReact = Effect.fn("SessionGoal.bumpReact")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const goal = data.get(sessionID)
      if (!goal) return 0
      goal.react += 1
      return goal.react
    })

    const evaluate = Effect.fn("SessionGoal.evaluate")(function* (input: EvaluateInput) {
      const language = yield* provider.getLanguage(input.model)
      const modelMessages = yield* MessageV2.toModelMessagesEffect(input.msgs, input.model)

      const authInfo = yield* auth.get(input.model.providerID).pipe(Effect.orDie)
      const isOpenaiOauth = input.model.providerID === "openai" && authInfo?.type === "oauth"

      const system: string[] = [JUDGE_SYSTEM]
      const user: ModelMessage = { role: "user", content: judgeUser(input.condition) }

      const messages: ModelMessage[] = [
        ...(isOpenaiOauth
          ? []
          : system.map((item): ModelMessage => ({ role: "system", content: item }))),
        ...modelMessages,
        user,
      ]

      const params = {
        temperature: 0,
        messages,
        model: language,
        schema: Object.assign(
          Schema.toStandardSchemaV1(Verdict),
          Schema.toStandardJSONSchemaV1(Verdict),
        ),
      } satisfies Parameters<typeof generateObject>[0]

      if (isOpenaiOauth) {
        return yield* Effect.promise(async () => {
          const result = streamObject({
            ...params,
            providerOptions: ProviderTransform.providerOptions(input.model, {
              instructions: system.join("\n"),
              store: false,
            }),
            onError: () => {},
          })
          for await (const part of result.fullStream) {
            if (part.type === "error") throw part.error
          }
          return result.object
        })
      }

      return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
    })

    return Service.of({ set, get, clear, bumpReact, evaluate })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
)

export const node = LayerNode.make(layer, [EventV2Bridge.node, Provider.node, Auth.node])

export * as SessionGoal from "./goal"
