import { afterEach, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Queue } from "effect"
import { Question } from "../../src/question"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { QuestionID } from "../../src/question/schema"
import { disposeAllInstances, provideInstance, reloadTestInstance, tmpdirScoped } from "../fixture/fixture"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"

const it = testEffect(
  Layer.mergeAll(Question.layer.pipe(Layer.provideMerge(Bus.layer)), CrossSpawnSpawner.defaultLayer),
)

const persistentIt = testEffect(
  Layer.mergeAll(
    Question.layer.pipe(Layer.provideMerge(Layer.mergeAll(Bus.layer, Session.defaultLayer))),
    CrossSpawnSpawner.defaultLayer,
  ),
)

const askEffect = Effect.fn("QuestionTest.ask")(function* (input: {
  sessionID: SessionID
  questions: ReadonlyArray<Question.Info>
  tool?: Question.Tool
}) {
  const question = yield* Question.Service
  return yield* question.ask(input)
})

const listEffect = Question.Service.use((svc) => svc.list())

const replyEffect = Effect.fn("QuestionTest.reply")(function* (input: {
  requestID: QuestionID
  answers: ReadonlyArray<Question.Answer>
}) {
  const question = yield* Question.Service
  yield* question.reply(input)
})

const rejectEffect = Effect.fn("QuestionTest.reject")(function* (id: QuestionID) {
  const question = yield* Question.Service
  yield* question.reject(id)
})

afterEach(async () => {
  await disposeAllInstances()
})

/** Reject all pending questions so dangling Deferred fibers don't hang the test. */
const rejectAll = Effect.gen(function* () {
  yield* Effect.forEach(yield* listEffect, (req) => rejectEffect(req.id), { discard: true })
})

const waitForPending = Effect.fn("QuestionTest.waitForPending")(function* (count: number) {
  const question = yield* Question.Service
  const bus = yield* Bus.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* bus.subscribeCallback(Question.Event.Asked, () => Queue.offerUnsafe(asked, undefined))
  yield* Effect.addFinalizer(() => Effect.sync(off))

  for (;;) {
    const pending = yield* question.list()
    if (pending.length === count) return pending
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

const createQuestionToolPart = Effect.fn("QuestionTest.createQuestionToolPart")(function* (input?: {
  request?: Question.Request
}) {
  const session = yield* Session.Service
  const info = yield* session.create({})
  const messageID = input?.request?.tool?.messageID ?? MessageID.ascending()
  const partID = PartID.ascending()
  const callID = input?.request?.tool?.callID ?? "test-question-call"

  yield* session.updateMessage({
    id: messageID,
    sessionID: info.id,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
  } as unknown as MessageV2.Info)

  yield* session.updatePart({
    id: partID,
    sessionID: info.id,
    messageID,
    type: "tool",
    tool: "question",
    callID,
    state: {
      status: "running",
      input: { questions: input?.request?.questions ?? [] },
      metadata: input?.request ? { questionRequest: input.request } : undefined,
      time: { start: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  return { sessionID: info.id, messageID, partID, callID }
})

const questionRequestMetadata = Effect.fn("QuestionTest.questionRequestMetadata")(function* (input: {
  sessionID: SessionID
  messageID: MessageID
  partID: PartID
}) {
  const session = yield* Session.Service
  const part = yield* session.getPart(input)
  if (part?.type !== "tool" || part.state.status !== "running") return undefined
  const request = part.state.metadata?.questionRequest
  return request && typeof request === "object" ? (request as Question.Request) : undefined
})

it.instance(
  "ask - remains pending until answered",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* rejectAll
      expect((yield* Fiber.await(fiber))._tag).toBe("Failure")
    }),
  { git: true },
)

it.instance(
  "ask - adds to pending list",
  () =>
    Effect.gen(function* () {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Option 1", description: "First option" },
            { label: "Option 2", description: "Second option" },
          ],
        },
      ]

      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions,
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending.length).toBe(1)
      expect(pending[0].questions).toEqual(questions)
      yield* rejectAll
      expect((yield* Fiber.await(fiber))._tag).toBe("Failure")
    }),
  { git: true },
)

// reply tests

it.instance(
  "reply - resolves the pending ask with answers",
  () =>
    Effect.gen(function* () {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Option 1", description: "First option" },
            { label: "Option 2", description: "Second option" },
          ],
        },
      ]

      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions,
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      const requestID = pending[0].id

      yield* replyEffect({
        requestID,
        answers: [["Option 1"]],
      })

      expect(yield* Fiber.join(fiber)).toEqual([["Option 1"]])
    }),
  { git: true },
)

it.instance(
  "reply - removes from pending list",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending.length).toBe(1)

      yield* replyEffect({
        requestID: pending[0].id,
        answers: [["Option 1"]],
      })
      yield* Fiber.join(fiber)

      const after = yield* listEffect
      expect(after.length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "reply - fails for unknown requestID",
  () =>
    Effect.gen(function* () {
      const exit = yield* replyEffect({
        requestID: QuestionID.make("que_unknown"),
        answers: [["Option 1"]],
      }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "Question.NotFoundError", requestID: "que_unknown" })
      }
    }),
  { git: true },
)

// reject tests

it.instance(
  "reject - throws RejectedError",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      yield* rejectEffect(pending[0].id)

      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(exit.cause.toString()).toContain("QuestionRejectedError")
    }),
  { git: true },
)

it.instance(
  "reject - removes from pending list",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending.length).toBe(1)

      yield* rejectEffect(pending[0].id)
      expect((yield* Fiber.await(fiber))._tag).toBe("Failure")

      const after = yield* listEffect
      expect(after.length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "reject - fails for unknown requestID",
  () =>
    Effect.gen(function* () {
      const exit = yield* rejectEffect(QuestionID.make("que_unknown")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "Question.NotFoundError", requestID: "que_unknown" })
      }
    }),
  { git: true },
)

// multiple questions tests

it.instance(
  "ask - handles multiple questions",
  () =>
    Effect.gen(function* () {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Build", description: "Build the project" },
            { label: "Test", description: "Run tests" },
          ],
        },
        {
          question: "Which environment?",
          header: "Env",
          options: [
            { label: "Dev", description: "Development" },
            { label: "Prod", description: "Production" },
          ],
        },
      ]

      const fiber = yield* askEffect({
        sessionID: SessionID.make("ses_test"),
        questions,
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)

      yield* replyEffect({
        requestID: pending[0].id,
        answers: [["Build"], ["Dev"]],
      })

      expect(yield* Fiber.join(fiber)).toEqual([["Build"], ["Dev"]])
    }),
  { git: true },
)

// list tests

it.instance(
  "list - returns all pending requests",
  () =>
    Effect.gen(function* () {
      const fiber1 = yield* askEffect({
        sessionID: SessionID.make("ses_test1"),
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
          },
        ],
      }).pipe(Effect.forkScoped)

      const fiber2 = yield* askEffect({
        sessionID: SessionID.make("ses_test2"),
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
          },
        ],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(2)
      expect(pending.length).toBe(2)
      yield* rejectAll
      expect((yield* Fiber.await(fiber1))._tag).toBe("Failure")
      expect((yield* Fiber.await(fiber2))._tag).toBe("Failure")
    }),
  { git: true },
)

it.instance(
  "list - returns empty when no pending",
  () =>
    Effect.gen(function* () {
      const pending = yield* listEffect
      expect(pending.length).toBe(0)
    }),
  { git: true },
)

it.live("questions stay isolated by directory", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped({ git: true })
    const two = yield* tmpdirScoped({ git: true })

    const fiber1 = yield* askEffect({
      sessionID: SessionID.make("ses_one"),
      questions: [
        {
          question: "Question 1?",
          header: "Q1",
          options: [{ label: "A", description: "A" }],
        },
      ],
    }).pipe(provideInstance(one), Effect.forkScoped)

    const fiber2 = yield* askEffect({
      sessionID: SessionID.make("ses_two"),
      questions: [
        {
          question: "Question 2?",
          header: "Q2",
          options: [{ label: "B", description: "B" }],
        },
      ],
    }).pipe(provideInstance(two), Effect.forkScoped)

    const onePending = yield* waitForPending(1).pipe(provideInstance(one))
    const twoPending = yield* waitForPending(1).pipe(provideInstance(two))

    expect(onePending.length).toBe(1)
    expect(twoPending.length).toBe(1)
    expect(onePending[0].sessionID).toBe(SessionID.make("ses_one"))
    expect(twoPending[0].sessionID).toBe(SessionID.make("ses_two"))

    yield* rejectEffect(onePending[0].id).pipe(provideInstance(one))
    yield* rejectEffect(twoPending[0].id).pipe(provideInstance(two))

    expect((yield* Fiber.await(fiber1))._tag).toBe("Failure")
    expect((yield* Fiber.await(fiber2))._tag).toBe("Failure")
  }),
)

it.live("pending question rejects on instance dispose", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const fiber = yield* askEffect({
      sessionID: SessionID.make("ses_dispose"),
      questions: [
        {
          question: "Dispose me?",
          header: "Dispose",
          options: [{ label: "Yes", description: "Yes" }],
        },
      ],
    }).pipe(provideInstance(dir), Effect.forkScoped)

    expect(yield* waitForPending(1).pipe(provideInstance(dir))).toHaveLength(1)
    const ctx = yield* Effect.gen(function* () {
      return yield* InstanceRef
    }).pipe(provideInstance(dir))
    if (!ctx) return yield* Effect.die(new Error("missing test instance"))
    yield* Effect.promise(() => InstanceRuntime.disposeInstance(ctx))

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
  }),
)

it.live("pending question rejects on instance reload", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const fiber = yield* askEffect({
      sessionID: SessionID.make("ses_reload"),
      questions: [
        {
          question: "Reload me?",
          header: "Reload",
          options: [{ label: "Yes", description: "Yes" }],
        },
      ],
    }).pipe(provideInstance(dir), Effect.forkScoped)

    expect(yield* waitForPending(1).pipe(provideInstance(dir))).toHaveLength(1)
    yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
  }),
)

persistentIt.instance(
  "ask - persists tool-backed question request to tool part metadata",
  () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const questions = [
        {
          question: "Persist me?",
          header: "Persist",
          options: [{ label: "Yes", description: "Yes" }],
        },
      ]
      const tool = yield* createQuestionToolPart()

      const fiber = yield* question
        .ask({
          sessionID: tool.sessionID,
          questions,
          tool: { messageID: tool.messageID, callID: tool.callID },
        })
        .pipe(Effect.forkScoped)

      const [pending] = yield* waitForPending(1)
      const persisted = yield* pollWithTimeout(
        questionRequestMetadata({
          sessionID: tool.sessionID,
          messageID: tool.messageID,
          partID: tool.partID,
        }),
        "timed out waiting for persisted question request",
      )

      expect(persisted).toMatchObject({
        id: pending.id,
        sessionID: tool.sessionID,
        tool: { messageID: tool.messageID, callID: tool.callID },
      })

      yield* question.reply({ requestID: pending.id, answers: [["Yes"]] })
      expect(yield* Fiber.join(fiber)).toEqual([["Yes"]])
    }),
  { git: true },
)

persistentIt.instance(
  "reply - recovers persisted request when in-memory pending is missing",
  () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const session = yield* Session.Service
      const messageID = MessageID.ascending()
      const request: Question.Request = {
        id: QuestionID.make("que_persisted_recovery"),
        sessionID: SessionID.make("ses_placeholder"),
        questions: [
          {
            question: "Recover me?",
            header: "Recover",
            options: [{ label: "Yes", description: "Yes" }],
          },
        ],
        tool: { messageID, callID: "test-recover-call" },
      }
      const tool = yield* createQuestionToolPart({ request: { ...request, sessionID: request.sessionID } })
      const persistedRequest = { ...request, sessionID: tool.sessionID, tool: { messageID: tool.messageID, callID: tool.callID } }
      const part = yield* session.getPart({
        sessionID: tool.sessionID,
        messageID: tool.messageID,
        partID: tool.partID,
      })
      if (part?.type !== "tool" || part.state.status !== "running") {
        return yield* Effect.die(new Error("missing persisted question tool part"))
      }
      yield* session.updatePart({
        ...part,
        state: {
          ...part.state,
          input: { questions: persistedRequest.questions },
          metadata: { questionRequest: persistedRequest },
        },
      })

      const listed = yield* question.list()
      expect(listed.map((item) => item.id)).toContain(persistedRequest.id)

      yield* question.reply({ requestID: persistedRequest.id, answers: [["Yes"]] })
      const completed = yield* session.getPart({
        sessionID: tool.sessionID,
        messageID: tool.messageID,
        partID: tool.partID,
      })

      expect(completed?.type).toBe("tool")
      if (completed?.type === "tool") {
        expect(completed.state.status).toBe("completed")
        if (completed.state.status === "completed") {
          expect(completed.state.metadata.answers).toEqual([["Yes"]])
          expect(completed.state.metadata.questionRequest).toBeUndefined()
          expect(completed.state.output).toContain(`"Recover me?"="Yes"`)
        }
      }
      expect(yield* question.list()).toHaveLength(0)
    }),
  { git: true },
)

persistentIt.instance(
  "ask - waits briefly for delayed tool part before persisting request",
  () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const session = yield* Session.Service
      const info = yield* session.create({})
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const callID = "test-delayed-question-call"
      const questions = [
        {
          question: "Delayed persist?",
          header: "Delayed",
          options: [{ label: "Yes", description: "Yes" }],
        },
      ]

      yield* session.updateMessage({
        id: messageID,
        sessionID: info.id,
        role: "user",
        time: { created: Date.now() },
        agent: "test",
        model: { providerID: "test", modelID: "test" },
        tools: {},
      } as unknown as MessageV2.Info)

      const fiber = yield* question
        .ask({
          sessionID: info.id,
          questions,
          tool: { messageID, callID },
        })
        .pipe(Effect.forkScoped)

      yield* Effect.sleep("40 millis")
      yield* session.updatePart({
        id: partID,
        sessionID: info.id,
        messageID,
        type: "tool",
        tool: "question",
        callID,
        state: {
          status: "running",
          input: { questions },
          time: { start: Date.now() },
        },
      } satisfies MessageV2.ToolPart)

      const [pending] = yield* waitForPending(1)
      const persisted = yield* pollWithTimeout(
        questionRequestMetadata({
          sessionID: info.id,
          messageID,
          partID,
        }),
        "timed out waiting for delayed persisted question request",
      )

      expect(persisted).toMatchObject({
        id: pending.id,
        sessionID: info.id,
        tool: { messageID, callID },
      })

      yield* question.reply({ requestID: pending.id, answers: [["Yes"]] })
      expect(yield* Fiber.join(fiber)).toEqual([["Yes"]])
    }),
  { git: true },
)
