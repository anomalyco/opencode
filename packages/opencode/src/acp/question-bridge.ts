import { Effect, Context, Layer } from "effect"
import type { CreateElicitationRequest, CreateElicitationResponse } from "@agentclientprotocol/sdk"
import { Question } from "@/question"
import { makeElicitationBridge, createElicitationRequest } from "./elicitation"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"

export type AcpQuestionBridge = {
  readonly ask: (input: {
    sessionID: string
    questions: ReadonlyArray<Question.Info>
    tool?: Question.Tool
  }) => Effect.Effect<ReadonlyArray<Question.Answer>, Question.RejectedError>
}

export class AcpQuestionBridgeService extends Context.Service<AcpQuestionBridgeService, AcpQuestionBridge>()(
  "@opencode/AcpQuestionBridge",
) {}

export function makeAcpQuestionBridge(connection: AgentSideConnection): AcpQuestionBridge {
  const bridge = makeElicitationBridge({
    unstable_createElicitation: (params) => connection.unstable_createElicitation(params),
  })

  return {
    ask: (input) =>
      Effect.gen(function* () {
        const schema = bridge.questionToElicitationSchema(input.questions)
        const elicitationRequest = createElicitationRequest(input.sessionID, input.questions, schema)

        const response = yield* Effect.tryPromise({
          try: () => connection.unstable_createElicitation(elicitationRequest),
          catch: (error) => new Question.RejectedError(),
        })

        return yield* bridge.elicitationToAnswers(response, input.questions)
      }),
  }
}

export function makeAcpQuestionBridgeLayer(connection: AgentSideConnection): Layer.Layer<AcpQuestionBridgeService> {
  return Layer.succeed(AcpQuestionBridgeService, makeAcpQuestionBridge(connection))
}
