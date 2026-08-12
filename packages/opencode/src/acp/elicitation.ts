import type { AgentSideConnection, CreateElicitationRequest, ElicitationPropertySchema } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import type { ACPSession } from "./session"

type Connection = Partial<Pick<AgentSideConnection, "unstable_createElicitation">>

type QuestionInfo = {
  readonly question: string
  readonly header: string
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
  readonly multiple?: boolean
}

type QuestionToolState = {
  readonly status: "running"
  readonly input: { readonly questions: ReadonlyArray<QuestionInfo> }
}

export type QuestionToolPart = {
  readonly sessionID: string
  readonly callID: string
  readonly state: QuestionToolState
}

export class Handler {
  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {}

  handle(part: QuestionToolPart) {
    void this.process(part).catch(() => {})
  }

  private async process(part: QuestionToolPart) {
    const session = await Effect.runPromise(this.input.session.tryGet(part.sessionID))
    if (!session) return

    const questions = part.state.input.questions
    if (!questions?.length) return

    if (!this.input.connection.unstable_createElicitation) {
      await this.input.sdk.question.reject({ requestID: part.callID, directory: session.cwd }).catch(() => {})
      return
    }

    const response = await this.input.connection
      .unstable_createElicitation(buildRequest(part.sessionID, part.callID, questions))
      .catch(() => undefined)

    if (!response || response.action !== "accept") {
      await this.input.sdk.question.reject({ requestID: part.callID, directory: session.cwd }).catch(() => {})
      return
    }

    const answers: string[][] = buildAnswers(questions, response.content ?? {}).map((a) => [...a])
    await this.input.sdk.question.reply({ requestID: part.callID, directory: session.cwd, answers }).catch(() => {})
  }
}

function buildRequest(
  sessionId: string,
  toolCallId: string,
  questions: ReadonlyArray<QuestionInfo>,
): CreateElicitationRequest {
  const properties: Record<string, ElicitationPropertySchema> = {}
  const required: string[] = []

  for (const q of questions) {
    properties[q.header] = toPropertySchema(q)
    required.push(q.header)
  }

  return {
    mode: "form",
    sessionId,
    toolCallId,
    message: questions.map((q) => q.question).join(" / "),
    requestedSchema: { type: "object", properties, required },
  }
}

function toPropertySchema(q: QuestionInfo): ElicitationPropertySchema {
  if (q.multiple) {
    return {
      type: "array",
      title: q.header,
      description: q.question,
      items: { anyOf: q.options.map((o) => ({ const: o.label, title: o.label })) },
    }
  }
  return {
    type: "string",
    title: q.header,
    description: q.question,
    enum: q.options.map((o) => o.label),
  }
}

function buildAnswers(
  questions: ReadonlyArray<QuestionInfo>,
  content: Record<string, unknown>,
): ReadonlyArray<ReadonlyArray<string>> {
  return questions.map((q) => {
    const value = content[q.header]
    if (Array.isArray(value)) return value.map(String)
    if (typeof value === "string" && value.length > 0) return [value]
    return []
  })
}

export * as ACPElicitation from "./elicitation"
