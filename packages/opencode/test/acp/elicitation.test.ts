import { describe, expect, it } from "bun:test"
import type { AgentSideConnection, CreateElicitationRequest, CreateElicitationResponse } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, ToolPart } from "@opencode-ai/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type QuestionReplyParams = Parameters<OpencodeClient["question"]["reply"]>[0]
type QuestionRejectParams = Parameters<OpencodeClient["question"]["reject"]>[0]

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
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

type QuestionOption = { label: string; description: string }

function questionPart(overrides: {
  sessionID: string
  callID: string
  questions?: Array<{ question: string; header: string; options: QuestionOption[]; multiple?: boolean }>
}): ToolPart {
  return {
    id: `part_${overrides.callID}`,
    sessionID: overrides.sessionID,
    messageID: `msg_${overrides.callID}`,
    type: "tool",
    callID: overrides.callID,
    tool: "question",
    state: {
      status: "running",
      input: {
        questions: overrides.questions ?? [
          {
            question: "Which environment?",
            header: "Environment",
            options: [
              { label: "staging", description: "Staging environment" },
              { label: "production", description: "Production environment" },
            ],
          },
        ],
      },
      title: "question",
      time: { start: Date.now() },
    },
  } as ToolPart
}

function toolUpdated(part: ToolPart): Event {
  return {
    id: `evt_${part.sessionID}_${part.messageID}_${part.id}_${part.state.status}`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      time: Date.now(),
      part,
    },
  }
}

function createHarness(createElicitation?: (params: CreateElicitationRequest) => Promise<CreateElicitationResponse>) {
  const replies: QuestionReplyParams[] = []
  const rejects: QuestionRejectParams[] = []
  const elicitations: CreateElicitationRequest[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()

  const sdk = {
    global: {
      event: () => Promise.resolve({ stream: (async function* () {})() }),
    },
    session: {
      message: () => Promise.resolve({ data: undefined }),
    },
    question: {
      reply: (params: QuestionReplyParams) => {
        replies.push(params)
        return Promise.resolve({ data: undefined })
      },
      reject: (params: QuestionRejectParams) => {
        rejects.push(params)
        return Promise.resolve({ data: undefined })
      },
    },
  } as unknown as OpencodeClient

  const connection = {
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
    ...(createElicitation
      ? {
          unstable_createElicitation: (params: CreateElicitationRequest) => {
            elicitations.push(params)
            return createElicitation(params)
          },
        }
      : {}),
  } satisfies Pick<AgentSideConnection, "sessionUpdate"> &
    Partial<Pick<AgentSideConnection, "unstable_createElicitation">>

  const subscription = new ACPEvent.Subscription({ sdk, connection, session })

  return { elicitations, replies, rejects, session, subscription, updates }
}

async function createSession(session: ACPSession.Interface, sessionId: string, cwd = "/workspace") {
  await Effect.runPromise(session.create({ id: sessionId, cwd }))
}

describe("acp elicitation", () => {
  it("sends unstable_createElicitation and replies with accepted answers", async () => {
    const harness = createHarness(() =>
      Promise.resolve({ action: "accept", content: { Environment: "staging" } }),
    )
    await createSession(harness.session, "ses_q")

    await harness.subscription.handle(toolUpdated(questionPart({ sessionID: "ses_q", callID: "call_q1" })))

    await pollUntil(() => harness.replies.length === 1, "question was never replied")

    expect(harness.elicitations).toHaveLength(1)
    expect(harness.elicitations[0]).toMatchObject({
      mode: "form",
      sessionId: "ses_q",
      toolCallId: "call_q1",
      message: "Which environment?",
      requestedSchema: {
        type: "object",
        properties: {
          Environment: {
            type: "string",
            title: "Environment",
            description: "Which environment?",
            enum: ["staging", "production"],
          },
        },
        required: ["Environment"],
      },
    })
    expect(harness.replies[0]).toMatchObject({
      requestID: "call_q1",
      directory: "/workspace",
      answers: [["staging"]],
    })
    expect(harness.rejects).toHaveLength(0)
  })

  it("rejects when client declines the elicitation", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "decline" }))
    await createSession(harness.session, "ses_decline")

    await harness.subscription.handle(toolUpdated(questionPart({ sessionID: "ses_decline", callID: "call_decline" })))

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after decline")

    expect(harness.rejects[0]).toMatchObject({ requestID: "call_decline", directory: "/workspace" })
    expect(harness.replies).toHaveLength(0)
  })

  it("rejects when client cancels the elicitation", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "cancel" }))
    await createSession(harness.session, "ses_cancel")

    await harness.subscription.handle(toolUpdated(questionPart({ sessionID: "ses_cancel", callID: "call_cancel" })))

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after cancel")

    expect(harness.rejects[0]).toMatchObject({ requestID: "call_cancel", directory: "/workspace" })
    expect(harness.replies).toHaveLength(0)
  })

  it("auto-rejects when client does not advertise elicitation support", async () => {
    const harness = createHarness(undefined)
    await createSession(harness.session, "ses_no_support")

    await harness.subscription.handle(
      toolUpdated(questionPart({ sessionID: "ses_no_support", callID: "call_no_support" })),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never auto-rejected for unsupported client")

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.rejects[0]).toMatchObject({ requestID: "call_no_support", directory: "/workspace" })
  })

  it("rejects when unstable_createElicitation throws", async () => {
    const harness = createHarness(() => Promise.reject(new Error("client elicitation UI failed")))
    await createSession(harness.session, "ses_err")

    await harness.subscription.handle(toolUpdated(questionPart({ sessionID: "ses_err", callID: "call_err" })))

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after elicitation error")

    expect(harness.rejects[0]).toMatchObject({ requestID: "call_err" })
    expect(harness.replies).toHaveLength(0)
  })

  it("maps multiple questions into a single elicitation form with one property per question", async () => {
    const harness = createHarness(() =>
      Promise.resolve({
        action: "accept",
        content: { Environment: "staging", Notify: "yes" },
      }),
    )
    await createSession(harness.session, "ses_multi_q")

    await harness.subscription.handle(
      toolUpdated(
        questionPart({
          sessionID: "ses_multi_q",
          callID: "call_multi_q",
          questions: [
            {
              question: "Which environment?",
              header: "Environment",
              options: [
                { label: "staging", description: "Staging" },
                { label: "production", description: "Production" },
              ],
            },
            {
              question: "Notify team?",
              header: "Notify",
              options: [
                { label: "yes", description: "Yes" },
                { label: "no", description: "No" },
              ],
            },
          ],
        }),
      ),
    )

    await pollUntil(() => harness.replies.length === 1, "multi-question elicitation was never replied")

    const schema = harness.elicitations[0]
    expect(schema?.mode).toBe("form")
    if (schema?.mode === "form") {
      expect(schema.requestedSchema.properties).toMatchObject({
        Environment: { type: "string", enum: ["staging", "production"] },
        Notify: { type: "string", enum: ["yes", "no"] },
      })
    }
    expect(harness.replies[0]).toMatchObject({
      answers: [["staging"], ["yes"]],
    })
  })

  it("maps multi-select questions to array schema with anyOf items", async () => {
    const harness = createHarness(() =>
      Promise.resolve({ action: "accept", content: { Regions: ["us-east-1", "eu-west-1"] } }),
    )
    await createSession(harness.session, "ses_multi")

    await harness.subscription.handle(
      toolUpdated(
        questionPart({
          sessionID: "ses_multi",
          callID: "call_multi",
          questions: [
            {
              question: "Which regions?",
              header: "Regions",
              options: [
                { label: "us-east-1", description: "US East" },
                { label: "eu-west-1", description: "EU West" },
              ],
              multiple: true,
            },
          ],
        }),
      ),
    )

    await pollUntil(() => harness.replies.length === 1, "multi-select question was never replied")

    const schema = harness.elicitations[0]
    expect(schema?.mode).toBe("form")
    if (schema?.mode === "form") {
      expect(schema.requestedSchema.properties?.["Regions"]).toMatchObject({
        type: "array",
        items: { anyOf: [{ const: "us-east-1", title: "us-east-1" }, { const: "eu-west-1", title: "eu-west-1" }] },
      })
    }
    expect(harness.replies[0]).toMatchObject({ answers: [["us-east-1", "eu-west-1"]] })
  })

  it("does not call elicitation for unknown sessions", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "accept", content: { Environment: "staging" } }))

    await harness.subscription.handle(
      toolUpdated(questionPart({ sessionID: "ses_missing", callID: "call_missing" })),
    )

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
    expect(harness.rejects).toHaveLength(0)
  })
})
