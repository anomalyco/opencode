import { afterEach, test, expect } from "bun:test"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { QuestionID } from "../../src/question/schema"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"

const ask = (input: { sessionID: SessionID; questions: ReadonlyArray<Question.Info>; tool?: Question.Tool }) =>
  AppRuntime.runPromise(Question.Service.use((svc) => svc.ask(input)))

const list = () => AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))

const reply = (input: { requestID: QuestionID; answers: ReadonlyArray<Question.Answer> }) =>
  AppRuntime.runPromise(Question.Service.use((svc) => svc.reply(input)))

const reject = (id: QuestionID) => AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(id)))

afterEach(async () => {
  await Instance.disposeAll()
})

/** Reject all pending questions so dangling Deferred fibers don't hang the test. */
async function rejectAll() {
  const pending = await list()
  for (const req of pending) {
    await reject(req.id)
  }
}

test("ask - returns pending promise", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = ask({
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
      })
      expect(promise).toBeInstanceOf(Promise)
      await rejectAll()
      await promise.catch(() => {})
    },
  })
})

test("ask - adds to pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
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

      const promise = ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await list()
      expect(pending.length).toBe(1)
      expect(pending[0].questions).toEqual(questions)
      await rejectAll()
      await promise.catch(() => {})
    },
  })
})

// reply tests

test("reply - resolves the pending ask with answers", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
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

      const promise = ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await list()
      const requestID = pending[0].id

      await reply({
        requestID,
        answers: [["Option 1"]],
      })

      const answers = await promise
      expect(answers).toEqual([["Option 1"]])
    },
  })
})

test("reply - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = ask({
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
      })

      const pending = await list()
      expect(pending.length).toBe(1)

      await reply({
        requestID: pending[0].id,
        answers: [["Option 1"]],
      })
      await promise

      const after = await list()
      expect(after.length).toBe(0)
    },
  })
})

test("reply - does nothing for unknown requestID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await reply({
        requestID: QuestionID.make("que_unknown"),
        answers: [["Option 1"]],
      })
      // Should not throw
    },
  })
})

// reject tests

test("reject - throws RejectedError", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = ask({
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
      })

      const pending = await list()
      await reject(pending[0].id)

      await expect(promise).rejects.toBeInstanceOf(Question.RejectedError)
    },
  })
})

test("reject - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = ask({
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
      })

      const pending = await list()
      expect(pending.length).toBe(1)

      await reject(pending[0].id)
      promise.catch(() => {}) // Ignore rejection

      const after = await list()
      expect(after.length).toBe(0)
    },
  })
})

test("reject - does nothing for unknown requestID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await reject(QuestionID.make("que_unknown"))
      // Should not throw
    },
  })
})

// multiple questions tests

test("ask - handles multiple questions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
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

      const promise = ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await list()

      await reply({
        requestID: pending[0].id,
        answers: [["Build"], ["Dev"]],
      })

      const answers = await promise
      expect(answers).toEqual([["Build"], ["Dev"]])
    },
  })
})

// list tests

test("list - returns all pending requests", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const p1 = ask({
        sessionID: SessionID.make("ses_test1"),
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
          },
        ],
      })

      const p2 = ask({
        sessionID: SessionID.make("ses_test2"),
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
          },
        ],
      })

      const pending = await list()
      expect(pending.length).toBe(2)
      await rejectAll()
      p1.catch(() => {})
      p2.catch(() => {})
    },
  })
})

test("list - returns empty when no pending", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = await list()
      expect(pending.length).toBe(0)
    },
  })
})

test("questions stay isolated by directory", async () => {
  await using one = await tmpdir({ git: true })
  await using two = await tmpdir({ git: true })

  const p1 = Instance.provide({
    directory: one.path,
    fn: () =>
      ask({
        sessionID: SessionID.make("ses_one"),
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
          },
        ],
      }),
  })

  const p2 = Instance.provide({
    directory: two.path,
    fn: () =>
      ask({
        sessionID: SessionID.make("ses_two"),
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
          },
        ],
      }),
  })

  const onePending = await Instance.provide({
    directory: one.path,
    fn: () => list(),
  })
  const twoPending = await Instance.provide({
    directory: two.path,
    fn: () => list(),
  })

  expect(onePending.length).toBe(1)
  expect(twoPending.length).toBe(1)
  expect(onePending[0].sessionID).toBe(SessionID.make("ses_one"))
  expect(twoPending[0].sessionID).toBe(SessionID.make("ses_two"))

  await Instance.provide({
    directory: one.path,
    fn: () => reject(onePending[0].id),
  })
  await Instance.provide({
    directory: two.path,
    fn: () => reject(twoPending[0].id),
  })

  await p1.catch(() => {})
  await p2.catch(() => {})
})

test("pending question rejects on instance dispose", async () => {
  await using tmp = await tmpdir({ git: true })

  const pending = Instance.provide({
    directory: tmp.path,
    fn: () => {
      return ask({
        sessionID: SessionID.make("ses_dispose"),
        questions: [
          {
            question: "Dispose me?",
            header: "Dispose",
            options: [{ label: "Yes", description: "Yes" }],
          },
        ],
      })
    },
  })
  const result = pending.then(
    () => "resolved" as const,
    (err) => err,
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const items = await list()
      expect(items).toHaveLength(1)
      await Instance.dispose()
    },
  })

  expect(await result).toBeInstanceOf(Question.RejectedError)
})

test("pending question rejects on instance reload", async () => {
  await using tmp = await tmpdir({ git: true })

  const pending = Instance.provide({
    directory: tmp.path,
    fn: () => {
      return ask({
        sessionID: SessionID.make("ses_reload"),
        questions: [
          {
            question: "Reload me?",
            header: "Reload",
            options: [{ label: "Yes", description: "Yes" }],
          },
        ],
      })
    },
  })
  const result = pending.then(
    () => "resolved" as const,
    (err) => err,
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const items = await list()
      expect(items).toHaveLength(1)
      await Instance.reload({ directory: tmp.path })
    },
  })

  expect(await result).toBeInstanceOf(Question.RejectedError)
})
