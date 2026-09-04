import { describe, expect, it } from "bun:test"
import type { AgentSideConnection, CreateElicitationRequest, CreateElicitationResponse } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
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

function questionAsked(overrides: {
  sessionID: string
  requestID: string
  toolCallID?: string
  type?: "question.asked" | "question.v2.asked"
  questions?: Array<{ question: string; header: string; options: QuestionOption[]; multiple?: boolean }>
}): Event {
  return {
    id: `evt_${overrides.requestID}`,
    type: overrides.type ?? "question.asked",
    properties: {
      id: overrides.requestID,
      sessionID: overrides.sessionID,
      tool: {
        messageID: `msg_${overrides.toolCallID ?? "call_q"}`,
        callID: overrides.toolCallID ?? "call_q",
      },
      questions:
        overrides.questions ?? [
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
  } as Event
}

function questionAskedWithoutTool(overrides: {
  sessionID: string
  requestID: string
  questions?: Array<{ question: string; header: string; options: QuestionOption[]; multiple?: boolean }>
}): Event {
  return {
    id: `evt_${overrides.requestID}`,
    type: "question.asked",
    properties: {
      id: overrides.requestID,
      sessionID: overrides.sessionID,
      questions:
        overrides.questions ?? [
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
  } as Event
}

function toolUpdatedQuestion(overrides: {
  sessionID: string
  callID: string
  questions?: Array<{ question: string; header: string; options: QuestionOption[]; multiple?: boolean }>
}): Event {
  return {
    id: `evt_${overrides.callID}`,
    type: "message.part.updated",
    properties: {
      sessionID: overrides.sessionID,
      time: Date.now(),
      part: {
        id: `part_${overrides.callID}`,
        sessionID: overrides.sessionID,
        messageID: `msg_${overrides.callID}`,
        type: "tool",
        callID: overrides.callID,
        tool: "question",
        state: {
          status: "running",
          input: {
            questions:
              overrides.questions ?? [
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
      },
    },
  } as Event
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
  if (createElicitation) subscription.enableElicitation()

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

    await harness.subscription.handle(
      questionAsked({ sessionID: "ses_q", requestID: "que_q1", toolCallID: "call_q1" }),
    )

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
      requestID: "que_q1",
      directory: "/workspace",
      answers: [["staging"]],
    })
    expect(harness.rejects).toHaveLength(0)
  })

  it("rejects when client declines the elicitation", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "decline" }))
    await createSession(harness.session, "ses_decline")

    await harness.subscription.handle(
      questionAsked({ sessionID: "ses_decline", requestID: "que_decline", toolCallID: "call_decline" }),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after decline")

    expect(harness.rejects[0]).toMatchObject({ requestID: "que_decline", directory: "/workspace" })
    expect(harness.replies).toHaveLength(0)
  })

  it("rejects when client cancels the elicitation", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "cancel" }))
    await createSession(harness.session, "ses_cancel")

    await harness.subscription.handle(
      questionAsked({ sessionID: "ses_cancel", requestID: "que_cancel", toolCallID: "call_cancel" }),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after cancel")

    expect(harness.rejects[0]).toMatchObject({ requestID: "que_cancel", directory: "/workspace" })
    expect(harness.replies).toHaveLength(0)
  })

  it("auto-rejects when client does not advertise elicitation support", async () => {
    const harness = createHarness(undefined)
    await createSession(harness.session, "ses_no_support")

    await harness.subscription.handle(
      questionAsked({ sessionID: "ses_no_support", requestID: "que_no_support", toolCallID: "call_no_support" }),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never auto-rejected for unsupported client")

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.rejects[0]).toMatchObject({ requestID: "que_no_support", directory: "/workspace" })
  })

  it("rejects when unstable_createElicitation throws", async () => {
    const harness = createHarness(() => Promise.reject(new Error("client elicitation UI failed")))
    await createSession(harness.session, "ses_err")

    await harness.subscription.handle(
      questionAsked({ sessionID: "ses_err", requestID: "que_err", toolCallID: "call_err" }),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected after elicitation error")

    expect(harness.rejects[0]).toMatchObject({ requestID: "que_err" })
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
      questionAsked({
        sessionID: "ses_multi_q",
        requestID: "que_multi_q",
        toolCallID: "call_multi_q",
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
      questionAsked({
        sessionID: "ses_multi",
        requestID: "que_multi",
        toolCallID: "call_multi",
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
      questionAsked({ sessionID: "ses_missing", requestID: "que_missing", toolCallID: "call_missing" }),
    )

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
    expect(harness.rejects).toHaveLength(0)
  })

  it("rejects empty question requests for known sessions", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "accept", content: {} }))
    await createSession(harness.session, "ses_empty")

    await harness.subscription.handle(
      questionAsked({
        sessionID: "ses_empty",
        requestID: "que_empty",
        toolCallID: "call_empty",
        questions: [],
      }),
    )

    await pollUntil(() => harness.rejects.length === 1, "empty question request was never rejected")

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
    expect(harness.rejects[0]).toMatchObject({ requestID: "que_empty", directory: "/workspace" })
  })

  it("does not reply to question tool call IDs from message part updates", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "accept", content: { Environment: "staging" } }))
    await createSession(harness.session, "ses_tool_part")

    await harness.subscription.handle(toolUpdatedQuestion({ sessionID: "ses_tool_part", callID: "call_tool_part" }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness.elicitations).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
    expect(harness.rejects).toHaveLength(0)
    expect(harness.updates).toHaveLength(2)
    expect(harness.updates.map((item) => item.update.sessionUpdate)).toEqual(["tool_call", "tool_call_update"])
  })

  it("omits toolCallId when the question event is not tied to a tool", async () => {
    const harness = createHarness(() =>
      Promise.resolve({ action: "accept", content: { Environment: "production" } }),
    )
    await createSession(harness.session, "ses_no_tool")

    await harness.subscription.handle(questionAskedWithoutTool({ sessionID: "ses_no_tool", requestID: "que_no_tool" }))

    await pollUntil(() => harness.replies.length === 1, "question without tool metadata was never replied")

    expect(harness.elicitations[0]).toMatchObject({
      mode: "form",
      sessionId: "ses_no_tool",
    })
    expect(Reflect.get(harness.elicitations[0] ?? {}, "toolCallId")).toBeUndefined()
    expect(harness.replies[0]).toMatchObject({
      requestID: "que_no_tool",
      answers: [["production"]],
    })
  })

  it("also handles v2 question events", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "accept", content: { Environment: "staging" } }))
    await createSession(harness.session, "ses_v2")

    await harness.subscription.handle(
      questionAsked({
        type: "question.v2.asked",
        sessionID: "ses_v2",
        requestID: "que_v2",
        toolCallID: "call_v2",
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "v2 question was never replied")

    expect(harness.elicitations[0]).toMatchObject({ sessionId: "ses_v2", toolCallId: "call_v2" })
    expect(harness.replies[0]).toMatchObject({ requestID: "que_v2", answers: [["staging"]] })
  })
})
