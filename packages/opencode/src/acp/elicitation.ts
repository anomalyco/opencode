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

export type QuestionRequest = {
  readonly id: string
  readonly sessionID: string
  readonly questions: ReadonlyArray<QuestionInfo>
  readonly tool?: { readonly messageID: string; readonly callID: string }
}

export class Handler {
  private supported = false

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {}

  enable() {
    this.supported = true
  }

  handle(request: QuestionRequest) {
    void this.process(request).catch(() => {})
  }

  private async process(request: QuestionRequest) {
    const session = await Effect.runPromise(this.input.session.tryGet(request.sessionID))
    if (!session) return

    const questions = request.questions
    if (!questions?.length) {
      await this.input.sdk.question.reject({ requestID: request.id, directory: session.cwd }).catch(() => {})
      return
    }

    if (!this.supported || !this.input.connection.unstable_createElicitation) {
      await this.input.sdk.question.reject({ requestID: request.id, directory: session.cwd }).catch(() => {})
      return
    }

    const response = await this.input.connection
      .unstable_createElicitation(buildRequest(request))
      .catch(() => undefined)

    if (!response || response.action !== "accept") {
      await this.input.sdk.question.reject({ requestID: request.id, directory: session.cwd }).catch(() => {})
      return
    }

    const answers: string[][] = buildAnswers(questions, response.content ?? {}).map((a) => [...a])
    await this.input.sdk.question.reply({ requestID: request.id, directory: session.cwd, answers }).catch(() => {})
  }
}

function buildRequest(request: QuestionRequest): CreateElicitationRequest {
  const properties: Record<string, ElicitationPropertySchema> = {}
  const required: string[] = []

  for (const q of request.questions) {
    properties[q.header] = toPropertySchema(q)
    required.push(q.header)
  }

  return {
    mode: "form",
    sessionId: request.sessionID,
    toolCallId: request.tool?.callID,
    message: request.questions.map((q) => q.question).join(" / "),
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
