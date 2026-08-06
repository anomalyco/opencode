import type { CreateElicitationRequest, CreateElicitationResponse, ElicitationSchema } from "@agentclientprotocol/sdk"
import { Question } from "@/question"
import { Effect } from "effect"

export type ElicitationBridge = {
  readonly questionToElicitationSchema: (
    prompts: ReadonlyArray<Question.Info>,
  ) => ElicitationSchema
  readonly elicitationToAnswers: (
    response: CreateElicitationResponse,
    prompts: ReadonlyArray<Question.Info>,
  ) => Effect.Effect<ReadonlyArray<Question.Answer>, Question.RejectedError>
}

export function makeElicitationBridge(connection: {
  unstable_createElicitation?: (params: CreateElicitationRequest) => Promise<CreateElicitationResponse>
}): ElicitationBridge {
  return {
    questionToElicitationSchema: (prompts) => {
      const properties: Record<string, { type: "string"; title: string; description: string; enum?: string[] }> = {}
      const required: string[] = []

      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i]
        const key = `q${i}`

        if (prompt.options && prompt.options.length > 0) {
          properties[key] = {
            type: "string",
            title: prompt.header,
            description: prompt.question,
            enum: prompt.options.map((opt) => opt.label),
          }
        } else {
          properties[key] = {
            type: "string",
            title: prompt.header,
            description: prompt.question,
          }
        }

        required.push(key)
      }

      return {
        type: "object" as const,
        properties,
        required: required.length > 0 ? required : undefined,
      }
    },

    elicitationToAnswers: (response, prompts) => {
      if (response.action === "decline" || response.action === "cancel") {
        return Effect.fail(new Question.RejectedError())
      }

      const answers: Question.Answer[] = []
      for (let i = 0; i < prompts.length; i++) {
        const key = `q${i}`
        const value = response.action === "accept" ? response.content?.[key] : undefined
        if (value !== undefined && value !== null) {
          answers.push([String(value)])
        } else {
          answers.push([])
        }
      }

      return Effect.succeed(answers)
    },
  }
}

export function createElicitationRequest(
  sessionId: string,
  prompts: ReadonlyArray<Question.Info>,
  schema: ElicitationSchema,
): CreateElicitationRequest {
  return {
    sessionId,
    mode: "form" as const,
    message: prompts.map((p) => p.question).join("\n"),
    requestedSchema: schema,
  }
}
