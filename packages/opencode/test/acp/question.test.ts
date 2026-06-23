import { describe, expect, it } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, QuestionAnswer } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type ExtMethodParams = { method: string; params: Record<string, unknown> }
type QuestionReplyParams = Parameters<OpencodeClient["question"]["reply"]>[0]
type QuestionRejectParams = Parameters<OpencodeClient["question"]["reject"]>[0]
type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]

const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  message: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
) => {
  const started = Date.now()
  while (true) {
    if (await check()) return
    if (Date.now() - started > (opts?.timeoutMs ?? 2000)) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, opts?.intervalMs ?? 5))
  }
}

function makeSessionService() {
  return ManagedRuntime.make(ACPSession.defaultLayer).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createHarness(
  extMethod: (params: ExtMethodParams) => Promise<Record<string, unknown>> = () =>
    Promise.resolve({ rejected: true }),
) {
  const replies: QuestionReplyParams[] = []
  const rejects: QuestionRejectParams[] = []
  const extCalls: ExtMethodParams[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()
  const sdk = {
    question: {
      reply: (params: QuestionReplyParams) => {
        replies.push(params)
        return Promise.resolve({ data: true })
      },
      reject: (params: QuestionRejectParams) => {
        rejects.push(params)
        return Promise.resolve({ data: true })
      },
    },
    session: {
      message: () => Promise.resolve({ data: undefined }),
    },
  } as unknown as OpencodeClient
  const connection = {
    extMethod: (method: string, params: Record<string, unknown>) => {
      const entry = { method, params }
      extCalls.push(entry)
      return extMethod(entry)
    },
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "extMethod" | "sessionUpdate">
  const subscription = new ACPEvent.Subscription({ sdk, connection, session })

  return { connection, extCalls, replies, rejects, sdk, session, subscription, updates }
}

async function createSession(session: ACPSession.Interface, sessionId: string, cwd = "/workspace") {
  await Effect.runPromise(session.create({ id: sessionId, cwd }))
}

function questionAsked(
  sessionID: string,
  id: string,
  input: { questions?: QuestionEvent["properties"]["questions"]; tool?: { messageID: string; callID: string } } = {},
): QuestionEvent {
  return {
    id: `evt_${id}`,
    type: "question.asked",
    properties: {
      id,
      sessionID,
      questions:
        input.questions ??
        [
          {
            header: "Build",
            question: "Start implementing?",
            options: [
              { label: "Yes", description: "Start implementing now" },
              { label: "No", description: "Keep planning" },
            ],
          },
        ],
      ...(input.tool ? { tool: input.tool } : {}),
    },
  } as QuestionEvent
}

describe("acp questions", () => {
  it("forwards question.asked to extMethod and replies with the answers when enabled", async () => {
    const harness = createHarness(() => Promise.resolve({ answers: [["Yes"]] }))
    await createSession(harness.session, "ses_a")
    harness.subscription.setQuestionEnabled(true)

    harness.subscription.handle(questionAsked("ses_a", "que_1", { tool: { messageID: "msg_1", callID: "call_1" } }))

    await pollUntil(() => harness.replies.length === 1, "question was never replied")

    expect(harness.extCalls).toEqual([
      {
        method: "opencode/question",
        params: {
          requestId: "que_1",
          sessionId: "ses_a",
          questions: [
            {
              header: "Build",
              question: "Start implementing?",
              options: [
                { label: "Yes", description: "Start implementing now" },
                { label: "No", description: "Keep planning" },
              ],
            },
          ],
          tool: { messageID: "msg_1", callID: "call_1" },
        },
      },
    ])
    expect(harness.replies).toEqual([
      { requestID: "que_1", answers: [["Yes"]] as QuestionAnswer[], directory: "/workspace" },
    ])
  })

  it("rejects when the ACP client declines a question", async () => {
    const harness = createHarness(() => Promise.resolve({ rejected: true }))
    await createSession(harness.session, "ses_a")
    harness.subscription.setQuestionEnabled(true)

    harness.subscription.handle(questionAsked("ses_a", "que_2"))

    await pollUntil(() => harness.rejects.length === 1, "declined question was never rejected")

    // A `rejected: true` (or any response without `answers`) falls through to reject,
    // so the agent is not left waiting on a question that will never be answered.
    expect(harness.rejects).toEqual([{ requestID: "que_2", directory: "/workspace" }])
    expect(harness.replies).toHaveLength(0)
  })

  it("rejects without calling extMethod when question support is disabled", async () => {
    const harness = createHarness(() => Promise.resolve({ answers: [["Yes"]] }))
    await createSession(harness.session, "ses_a")
    // question support left disabled (no capability advertised)

    harness.subscription.handle(questionAsked("ses_a", "que_3"))

    await pollUntil(() => harness.rejects.length === 1, "unsupported question was never rejected")

    expect(harness.extCalls).toHaveLength(0)
    expect(harness.rejects).toEqual([{ requestID: "que_3", directory: "/workspace" }])
    expect(harness.replies).toHaveLength(0)
  })

  it("rejects when extMethod throws", async () => {
    const harness = createHarness(() => Promise.reject(new Error("client disconnected")))
    await createSession(harness.session, "ses_a")
    harness.subscription.setQuestionEnabled(true)

    harness.subscription.handle(questionAsked("ses_a", "que_4"))

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after extMethod threw")

    expect(harness.rejects).toEqual([{ requestID: "que_4", directory: "/workspace" }])
    expect(harness.replies).toHaveLength(0)
  })
})
