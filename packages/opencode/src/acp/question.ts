import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, QuestionAnswer } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import type { ACPSession } from "./session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type Connection = Partial<Pick<AgentSideConnection, "extMethod">>

// The ACP client advertises question support at initialize time; it stays
// false until `initialize()` sees the `opencode/question` capability and flips
// it on. Until then, question prompts are rejected so non-supporting clients
// are not left hanging.
export class Handler {
  private readonly queues = new Map<string, Promise<void>>()
  private enabled: boolean

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {
    this.enabled = false
  }

  enable(value: boolean) {
    this.enabled = value
  }

  handle(event: QuestionEvent) {
    const question = event.properties
    const previous = this.queues.get(question.sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(question.sessionID) === next) {
          this.queues.delete(question.sessionID)
        }
      })
    this.queues.set(question.sessionID, next)
  }

  private async process(event: QuestionEvent) {
    const question = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(question.sessionID))
    if (!session) return

    if (!this.enabled || !this.input.connection.extMethod) {
      await this.reject(question.id, session.cwd)
      return
    }

    const response = await this.input.connection
      .extMethod("opencode/question", {
        requestId: question.id,
        sessionId: question.sessionID,
        questions: question.questions,
        ...(question.tool ? { tool: question.tool } : {}),
      })
      .catch(async () => {
        await this.reject(question.id, session.cwd)
        return undefined
      })

    if (!response) return

    const answers = parseAnswers(response)
    if (answers) {
      await this.input.sdk.question.reply({
        requestID: question.id,
        answers,
        directory: session.cwd,
      })
      return
    }

    await this.reject(question.id, session.cwd)
  }

  private async reject(requestID: string, directory: string) {
    await this.input.sdk.question.reject({
      requestID,
      directory,
    })
  }
}

// extMethod returns `Record<string, unknown>`; validate the response shape
// before forwarding. `QuestionAnswer` is `string[]` (the selected labels for
// one question), and `answers` is one entry per question.
function parseAnswers(value: unknown): QuestionAnswer[] | undefined {
  if (!value || typeof value !== "object") return undefined
  const answers = (value as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return undefined
  return answers.filter(isAnswer)
}

function isAnswer(value: unknown): value is QuestionAnswer {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export * as ACPQuestion from "./question"
